import { z } from "zod";
import { quotaWindowSchema, type QuotaAdapter, type QuotaSourceIdentity } from "./quota-adapter";
import { resetContract } from "./reset-contract";

const providerId = "codex";
const pluginId = "provider-codex";
const label = "Codex";

const resourcesSchema = z.object({ resources: z.array(z.object({
  id: z.string(), providerId: z.string(), accountKey: z.string().nullish(),
  scope: z.object({ kind: z.string(), hostId: z.string().optional() }),
})) });

const providerUsageSchema = z.object({ accountKey: z.unknown().optional(), observedAt: z.number().nullable(), usage: z.object({
  status: z.string(), planLabel: z.string().nullable().optional(),
  windows: z.array(z.object({
    id: z.string(), kind: quotaWindowSchema.shape.kind, label: z.string(),
    usedPercent: z.number().nonnegative(), resetsAt: z.string().nullable(),
  })).optional(),
}) });

function sourceIdentity(resourceId: string, accountKey: unknown): QuotaSourceIdentity | null {
  return typeof accountKey === "string" && accountKey.length ? { resourceId, accountKey } : null;
}

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

    function getUsage(resourceId: string, refresh: boolean, signal: AbortSignal) {
      return bb.sdk.plugins.callRpc({
        pluginId, method: "provider-usage.v1.getResource", input: { resourceId, refresh },
        outputSchema: providerUsageSchema, signal,
      });
    }

    return {
      async resolveSource({ hostId, signal }) {
        const resource = await findResource(hostId, signal);
        if (!resource) return null;
        const known = sourceIdentity(resource.id, resource.accountKey);
        if (known) return known;
        const { accountKey } = await getUsage(resource.id, false, signal);
        return sourceIdentity(resource.id, accountKey);
      },
      async readQuota({ hostId, refresh, signal }) {
        const resource = await findResource(hostId, signal);
        if (!resource) return { account: null, error: "unavailable" };
        const { accountKey, observedAt, usage } = await getUsage(resource.id, refresh, signal);
        if (usage.status !== "ok" || observedAt === null || !usage.windows?.length) {
          return { account: null, error: "unavailable" };
        }
        return { source: sourceIdentity(resource.id, accountKey) ?? undefined, error: null, account: {
          plan: usage.planLabel || label, observedAt,
          windows: usage.windows.map((window) => ({
            id: window.id, label: window.label, kind: window.kind,
            remaining: Math.max(0, 100 - window.usedPercent), resetsAt: window.resetsAt,
          })),
        } };
      },
      async readAvailableResets({ hostId, includeExpiries, signal, source }) {
        const accountKey = source?.accountKey ?? (await findResource(hostId, signal))?.accountKey;
        if (!accountKey) return { count: null };
        // The host compares this account with the account in the same app-server reply as the count.
        const result = await host.call("availableResets", { accountKey, includeExpiries }, { hostId, signal });
        return { ...result, source };
      },
    };
  },
};
