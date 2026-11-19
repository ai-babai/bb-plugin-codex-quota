import { codexAdapter } from "./codex-adapter";
import type { QuotaAdapter } from "./quota-adapter";

export const quotaAdapters = [codexAdapter] satisfies readonly QuotaAdapter[];
