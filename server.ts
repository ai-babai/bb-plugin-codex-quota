import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { resetContract } from "./lib/reset-contract";

const windowSchema = z.object({
  id: z.string(), label: z.string(), kind: z.enum(["five-hour", "daily", "weekly", "custom"]),
  remaining: z.number().min(0).max(100), resetsAt: z.string().nullable(),
});
const quotaSchema = z.object({
  account: z.object({ plan: z.string(), observedAt: z.number().nullable(), windows: z.array(windowSchema) }).nullable(),
  error: z.enum(["unavailable", "refresh_failed"]).nullable(),
});
export type Quota = z.infer<typeof quotaSchema>;
export type QuotaWindow = z.infer<typeof windowSchema>;
const locationSchema = z.union([
  z.object({ threadId: z.string().min(1) }),
  z.object({ environmentId: z.string().min(1) }),
  z.object({ hostId: z.string().min(1) }),
]);
export type QuotaLocation = z.infer<typeof locationSchema>;
export const rpcContract = defineRpcContract({
  availableResets: { input: locationSchema.and(z.object({ includeExpiries: z.boolean().optional() })), output: resetContract.availableResets.output },
  quota: { input: locationSchema.and(z.object({ refresh: z.boolean().default(false) })), output: quotaSchema },
});
const resourcesSchema = z.object({ resources: z.array(z.object({
  id: z.string(), providerId: z.string(), accountKey: z.string().nullish(), scope: z.object({ kind: z.string(), hostId: z.string().optional() }),
})) });
// Deliberately omit account identity, e-mail and credentials from our contract.
const providerUsageSchema = z.object({ observedAt: z.number().nullable(), usage: z.object({
  status: z.string(), planLabel: z.string().nullable().optional(),
  windows: z.array(z.object({
    id: z.string(), kind: windowSchema.shape.kind, label: z.string(),
    usedPercent: z.number().nonnegative(), resetsAt: z.string().nullable(),
  })).optional(),
}) });

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: resetContract });
  async function resolveHost(location: QuotaLocation) {
    if ("hostId" in location) return location.hostId;
    if ("environmentId" in location) return (await bb.sdk.environments.get({ environmentId: location.environmentId })).hostId;
    const thread = await bb.sdk.threads.get({ threadId: location.threadId });
    if (thread.providerId !== "codex" || !thread.environmentId) return null;
    return (await bb.sdk.environments.get({ environmentId: thread.environmentId })).hostId;
  }
  async function findResource(location: QuotaLocation) {
    const hostId = await resolveHost(location);
    if (!hostId) return null;
    const inventory = await bb.sdk.plugins.callRpc({ pluginId: "provider-codex",
      method: "provider-usage.v1.listResources", input: {}, outputSchema: resourcesSchema });
    const resource = inventory.resources.find(r => r.providerId === "codex" && r.scope.kind === "host" && r.scope.hostId === hostId);
    return resource ? { resource, hostId } : null;
  }
  bb.settings.define({
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
    availableResets: async ({ includeExpiries = false, ...location }, context) => {
      try {
        const target = await findResource(location);
        if (!target?.resource.accountKey) return { count: null };
        return await host.call("availableResets", { accountKey: target.resource.accountKey, includeExpiries },
          { hostId: target.hostId, signal: context.experimental_signal });
      } catch {
        return { count: null };
      }
    },
    quota: async ({ refresh, ...location }): Promise<Quota> => {
      try {
        const target = await findResource(location);
        const resource = target?.resource;
        if (!resource) return { account: null, error: "unavailable" };
        const result = await bb.sdk.plugins.callRpc({ pluginId: "provider-codex",
          method: "provider-usage.v1.getResource", input: { resourceId: resource.id, refresh }, outputSchema: providerUsageSchema });
        const { observedAt, usage } = result;
        if (usage.status !== "ok" || observedAt === null || !usage.windows?.length) {
          return { account: null, error: "unavailable" };
        }
        return { error: null, account: {
          plan: usage.planLabel || "Codex", observedAt,
          windows: usage.windows.map((window) => ({
            id: window.id, label: window.label, kind: window.kind,
            remaining: Math.max(0, 100 - window.usedPercent), resetsAt: window.resetsAt,
          })),
        } };
      } catch { return { account: null, error: "refresh_failed" }; }
    },
  });
}
