import { createHmac, randomBytes } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  quotaReadingSchema, type QuotaAdapter, type QuotaCollector, type QuotaReading, type QuotaScope, type QuotaSourceIdentity,
} from "./lib/quota-adapter";
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
const expectedSourceKeySchema = z.string().min(1).optional();
export const rpcContract = defineRpcContract({
  listProviders: { input: z.object({}).strict(), output: z.object({ providers: z.array(quotaProviderSchema) }) },
  resolveSource: { input: locationSchema, output: z.object({ sourceKey: z.string().nullable() }) },
  availableResets: {
    input: locationSchema.and(z.object({ includeExpiries: z.boolean().optional(), expectedSourceKey: expectedSourceKeySchema })),
    output: resetContract.availableResets.output,
  },
  quota: {
    input: locationSchema.and(z.object({ refresh: z.boolean().default(false), expectedSourceKey: expectedSourceKeySchema })),
    output: quotaReadingSchema,
  },
});

type RegisteredCollector = { provider: QuotaProvider; collector: QuotaCollector };
type QuotaTarget = RegisteredCollector & { scope: QuotaScope };

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
  return hostId ? { ...registered, scope: { ...scope, hostId } } : null;
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
  return registered ? { ...registered, scope: { hostId: location.hostId } } : null;
}

function sourceKeyFor(secret: Buffer, target: QuotaTarget, source?: QuotaSourceIdentity | null) {
  const { hostId, environmentId, threadId } = target.scope;
  let identity;
  if (target.collector.resolveSource) {
    if (!source) return null;
    identity = ["resource", source.resourceId, source.accountKey];
  } else {
    identity = ["scope", environmentId ?? null, threadId ?? null];
  }
  const keyMaterial = JSON.stringify([target.provider.id, hostId, ...identity]);
  return createHmac("sha256", secret).update(keyMaterial).digest("base64url");
}

function matchesSource(secret: Buffer, target: QuotaTarget, expected?: string, source?: QuotaSourceIdentity | null) {
  return expected === undefined || sourceKeyFor(secret, target, source) === expected;
}

async function lookupSource(target: QuotaTarget, signal: AbortSignal) {
  return target.collector.resolveSource?.({ ...target.scope, signal });
}

export function createQuotaPlugin(adapters: readonly QuotaAdapter[]) {
  return (bb: BbPluginApi) => registerPlugin(bb, adapters);
}

function registerPlugin(bb: BbPluginApi, adapters: readonly QuotaAdapter[]) {
  const collectors = registerCollectors(bb, adapters);
  const sourceSecret = randomBytes(32);
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
    resolveSource: async (location, { experimental_signal: signal }) => {
      try {
        const target = await resolveTarget(bb, collectors, location);
        if (!target) return { sourceKey: null };
        const source = await lookupSource(target, signal);
        return { sourceKey: sourceKeyFor(sourceSecret, target, source) };
      } catch {
        return { sourceKey: null };
      }
    },
    availableResets: async ({ includeExpiries = false, expectedSourceKey, ...location }, { experimental_signal: signal }) => {
      try {
        const target = await resolveTarget(bb, collectors, location);
        if (!target?.collector.readAvailableResets) return { count: null };
        const source = expectedSourceKey === undefined ? undefined : await lookupSource(target, signal);
        if (!matchesSource(sourceSecret, target, expectedSourceKey, source)) return { count: null };
        const { source: observedSource, ...result } = await target.collector.readAvailableResets({
          ...target.scope, includeExpiries, signal, ...(source ? { source } : {}),
        });
        if (!matchesSource(sourceSecret, target, expectedSourceKey, observedSource)) return { count: null };
        const summary = resetContract.availableResets.output.parse(result);
        return includeExpiries ? summary : { count: summary.count };
      } catch {
        return { count: null };
      }
    },
    quota: async ({ refresh, expectedSourceKey, ...location }, { experimental_signal: signal }): Promise<Quota> => {
      try {
        const target = await resolveTarget(bb, collectors, location);
        if (!target) return { account: null, error: "unavailable" };
        const result = await target.collector.readQuota({ ...target.scope, refresh, signal });
        if (!matchesSource(sourceSecret, target, expectedSourceKey, result.source)) {
          return { account: null, error: "unavailable" };
        }
        return quotaReadingSchema.parse(result);
      } catch { return { account: null, error: "refresh_failed" }; }
    },
  });
}

export default createQuotaPlugin(quotaAdapters);
