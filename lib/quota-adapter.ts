import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { resetContract } from "./reset-contract";

export const quotaWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["five-hour", "daily", "weekly", "custom"]),
  remaining: z.number().min(0).max(100),
  resetsAt: z.string().nullable(),
});

export const quotaReadingSchema = z.object({
  account: z.object({
    plan: z.string(),
    observedAt: z.number().nullable(),
    windows: z.array(quotaWindowSchema),
  }).nullable(),
  error: z.enum(["unavailable", "refresh_failed"]).nullable(),
});

export type QuotaWindow = z.infer<typeof quotaWindowSchema>;
export type QuotaReading = z.infer<typeof quotaReadingSchema>;
export type ResetResult = z.infer<typeof resetContract.availableResets.output>;

export type QuotaScope = { hostId: string; environmentId?: string; threadId?: string };
export type QuotaSourceIdentity = { resourceId: string; accountKey: string };
type CollectorScope = QuotaScope & { signal: AbortSignal };
type CollectorReading<T> = T & { source?: QuotaSourceIdentity };

export interface QuotaCollector {
  resolveSource?(input: CollectorScope): Promise<QuotaSourceIdentity | null>;
  readQuota(input: CollectorScope & { refresh: boolean }): Promise<CollectorReading<QuotaReading>>;
  readAvailableResets?(input: CollectorScope & {
    includeExpiries: boolean;
    source?: QuotaSourceIdentity;
  }): Promise<CollectorReading<ResetResult>>;
}

export interface QuotaAdapter {
  id: string;
  label: string;
  create(bb: BbPluginApi): QuotaCollector;
}
