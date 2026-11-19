import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { quotaReadingSchema, type QuotaAdapter, type QuotaCollector, type QuotaReading, type QuotaScope } from "./lib/quota-adapter";
import { quotaAdapters } from "./lib/quota-adapters";
import { resetContract } from "./lib/reset-contract";

export type { QuotaWindow } from "./lib/quota-adapter";

const quotaProviderSchema = z.object({
  id: z.string(),
  label: z.string(),
  capabilities: z.object({ resets: z.boolean() }),
});
export type QuotaProvider = z.infer<typeof quotaProviderSchema>;
export type Quota = QuotaReading;
const locationSchema = z.union([
  z.object({ threadId: z.string().min(1) }),
  z.object({ environmentId: z.string().min(1) }),
  z.object({ hostId: z.string().min(1) }),
]).and(z.object({ providerId: z.string().min(1).optional() }));
export type QuotaLocation = z.infer<typeof locationSchema>;
export const rpcContract = defineRpcContract({
  listProviders: { input: z.object({}).strict(), output: z.object({ providers: z.array(quotaProviderSchema) }) },
  availableResets: { input: locationSchema.and(z.object({ includeExpiries: z.boolean().optional() })), output: resetContract.availableResets.output },
  quota: { input: locationSchema.and(z.object({ refresh: z.boolean().default(false) })), output: quotaReadingSchema },
});

type RegisteredCollector = { provider: QuotaProvider; collector: QuotaCollector };
type QuotaTarget = { collector: QuotaCollector; scope: QuotaScope };

function registerCollectors(bb: BbPluginApi, adapters: readonly QuotaAdapter[]) {
  const collectors = new Map<string, RegisteredCollector>();
  for (const adapter of adapters) {
    const { id, label } = adapter;
    if (collectors.has(id)) throw new Error(`Duplicate quota provider: ${id}`);
    const collector = adapter.create(bb);
    const provider = { id, label, capabilities: { resets: Boolean(collector.readAvailableResets) } };
    collectors.set(id, { collector, provider });
  }
  return collectors;
}

async function resolveEnvironmentTarget(
  bb: BbPluginApi, registered: RegisteredCollector | undefined, scope: { environmentId: string; threadId?: string },
): Promise<QuotaTarget | null> {
  if (!registered) return null;
  const { hostId } = await bb.sdk.environments.get({ environmentId: scope.environmentId });
  return hostId ? { collector: registered.collector, scope: { ...scope, hostId } } : null;
}

async function resolveTarget(
  bb: BbPluginApi, collectors: ReadonlyMap<string, RegisteredCollector>, location: QuotaLocation,
): Promise<QuotaTarget | null> {
  if ("threadId" in location) {
    const { threadId, providerId } = location;
    const thread = await bb.sdk.threads.get({ threadId });
    if (!thread.providerId || !thread.environmentId) return null;
    if (providerId !== undefined && providerId !== thread.providerId) return null;
    return resolveEnvironmentTarget(bb, collectors.get(thread.providerId), { threadId, environmentId: thread.environmentId });
  }

  const registered = collectors.get(location.providerId ?? "codex");
  if ("environmentId" in location) return resolveEnvironmentTarget(bb, registered, { environmentId: location.environmentId });
  return registered ? { collector: registered.collector, scope: { hostId: location.hostId } } : null;
}

export function createQuotaPlugin(adapters: readonly QuotaAdapter[]) {
  return (bb: BbPluginApi) => registerPlugin(bb, adapters);
}

function registerPlugin(bb: BbPluginApi, adapters: readonly QuotaAdapter[]) {
  const collectors = registerCollectors(bb, adapters);
  bb.settings.define({
    showInChat: { type: "boolean", label: "Show in chat", default: true },
    showInSidebar: { type: "boolean", label: "Show in left sidebar", default: true },
    refreshIntervalSeconds: {
      type: "number", label: "Auto-refresh interval (seconds)", default: 120,
      description: "Poll while the thread is visible. Set to 0 to turn off the timer.",
      experimental_schema: z.int().min(0).max(Math.floor(2_147_483_647 / 1000)),
    },
    refreshOnHover: { type: "boolean", label: "Refresh when hovering over the ring", default: true },
    refreshOnPress: { type: "boolean", label: "Refresh when pressing the ring", default: true },
    language: {
      type: "select",
      label: "Language",
      options: ["en", "ru"],
      experimental_optionLabels: { en: "English", ru: "Русский" },
      default: "en",
    },
  });
  bb.rpc.register(rpcContract, {
    listProviders: () => ({ providers: [...collectors.values()].map(({ provider }) => provider) }),
    availableResets: async ({ includeExpiries = false, ...location }, context) => {
      try {
        const target = await resolveTarget(bb, collectors, location);
        if (!target?.collector.readAvailableResets) return { count: null };
        const result = await target.collector.readAvailableResets({
          ...target.scope, includeExpiries, signal: context.experimental_signal,
        });
        const summary = resetContract.availableResets.output.parse(result);
        return includeExpiries ? summary : { count: summary.count };
      } catch {
        return { count: null };
      }
    },
    quota: async ({ refresh, ...location }, context): Promise<Quota> => {
      try {
        const target = await resolveTarget(bb, collectors, location);
        if (!target) return { account: null, error: "unavailable" };
        const result = await target.collector.readQuota({
          ...target.scope, refresh, signal: context.experimental_signal,
        });
        return quotaReadingSchema.parse(result);
      } catch { return { account: null, error: "refresh_failed" }; }
    },
  });
}

export default createQuotaPlugin(quotaAdapters);
