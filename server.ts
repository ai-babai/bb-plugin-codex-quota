import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

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
export const rpcContract = defineRpcContract({
  quota: { input: z.object({ threadId: z.string().min(1), refresh: z.boolean().default(false) }), output: quotaSchema },
});
const resourcesSchema = z.object({ resources: z.array(z.object({
  id: z.string(), providerId: z.string(), scope: z.object({ kind: z.string(), hostId: z.string().optional() }),
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
  bb.settings.define({
    language: {
      type: "select",
      label: "Language",
      options: ["en", "ru"],
      experimental_optionLabels: { en: "English", ru: "Русский" },
      default: "en",
    },
  });
  bb.rpc.register(rpcContract, {
    quota: async ({ threadId, refresh }): Promise<Quota> => {
      try {
        const thread = await bb.sdk.threads.get({ threadId });
        if (thread.providerId !== "codex" || !thread.environmentId) return { account: null, error: "unavailable" };
        const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
        const inventory = await bb.sdk.plugins.callRpc({ pluginId: "provider-codex",
          method: "provider-usage.v1.listResources", input: {}, outputSchema: resourcesSchema });
        const resource = inventory.resources.find((r) => r.providerId === "codex" && r.scope.kind === "host" && r.scope.hostId === environment.hostId);
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
