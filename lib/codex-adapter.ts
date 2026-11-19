import { z } from "zod";
import { quotaWindowSchema, type QuotaAdapter } from "./quota-adapter";
import { resetContract } from "./reset-contract";

const providerId = "codex";
const pluginId = "provider-codex";
const label = "Codex";

const resourcesSchema = z.object({ resources: z.array(z.object({
  id: z.string(), providerId: z.string(), accountKey: z.string().nullish(),
  scope: z.object({ kind: z.string(), hostId: z.string().optional() }),
})) });

const providerUsageSchema = z.object({ observedAt: z.number().nullable(), usage: z.object({
  status: z.string(), planLabel: z.string().nullable().optional(),
  windows: z.array(z.object({
    id: z.string(), kind: quotaWindowSchema.shape.kind, label: z.string(),
    usedPercent: z.number().nonnegative(), resetsAt: z.string().nullable(),
  })).optional(),
}) });

export const codexAdapter: QuotaAdapter = {
  id: providerId,
  label,
  create(bb) {
    const host = bb.hosts.experimental_client({ contract: resetContract });

    async function findResource(hostId: string, signal: AbortSignal) {
      const inventory = await bb.sdk.plugins.callRpc({
        pluginId, method: "provider-usage.v1.listResources", input: {}, outputSchema: resourcesSchema, signal,
      });
      return inventory.resources.find(r => r.providerId === providerId && r.scope.kind === "host" && r.scope.hostId === hostId);
    }

    return {
      async readQuota({ hostId, refresh, signal }) {
        const resource = await findResource(hostId, signal);
        if (!resource) return { account: null, error: "unavailable" };
        const { observedAt, usage } = await bb.sdk.plugins.callRpc({
          pluginId, method: "provider-usage.v1.getResource", input: { resourceId: resource.id, refresh },
          outputSchema: providerUsageSchema, signal,
        });
        if (usage.status !== "ok" || observedAt === null || !usage.windows?.length) {
          return { account: null, error: "unavailable" };
        }
        return { error: null, account: {
          plan: usage.planLabel || label, observedAt,
          windows: usage.windows.map((window) => ({
            id: window.id, label: window.label, kind: window.kind,
            remaining: Math.max(0, 100 - window.usedPercent), resetsAt: window.resetsAt,
          })),
        } };
      },
      async readAvailableResets({ hostId, includeExpiries, signal }) {
        const resource = await findResource(hostId, signal);
        if (!resource?.accountKey) return { count: null };
        return host.call("availableResets", { accountKey: resource.accountKey, includeExpiries }, { hostId, signal });
      },
    };
  },
};
