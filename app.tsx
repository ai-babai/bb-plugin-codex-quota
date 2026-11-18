import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QuotaPopover } from "./lib/quota-popover";
import { definePluginApp, useComposer, useSettings } from "@get-bb/plugin-sdk/app";
import { mountUsageFooter } from "./lib/usage-footer";
import { getQuotaFormat, isFresh } from "./lib/format";
import type { QuotaWindow } from "./server";
import { useQuota } from "./lib/use-quota";

function WindowRow({ window, fresh, now, format }: {
  window: QuotaWindow;
  fresh: boolean;
  now: number;
  format: ReturnType<typeof getQuotaFormat>;
}) {
  const { text, percent, formatDate, formatCountdown } = format;
  const label = window.kind === "five-hour" ? text.fiveHour : window.kind === "daily" ? text.daily : window.kind === "weekly" ? text.weekly : window.label;
  const resetAt = window.resetsAt ? Date.parse(window.resetsAt) : NaN;
  const untilReset = Number.isFinite(resetAt) ? Math.max(0, resetAt - now) : null;
  const current = fresh && untilReset !== 0;
  const seconds = window.kind === "five-hour" ? 18000 : window.kind === "daily" ? 86400 : window.kind === "weekly" ? 604800 : null;
  const timePercent = untilReset !== null && seconds !== null ? Math.min(100, untilReset / (seconds * 1000) * 100) : null;
  const tone = !current ? "bg-foreground/10" : window.remaining <= 10 ? "bg-destructive/25" : window.remaining <= 25 ? "bg-amber-500/25" : "bg-emerald-500/25";
  return <div className="space-y-1.5 py-2">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="text-xs font-medium">{label}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{percent.format(100 - window.remaining)}% {text.used}{!current ? ` · ${text.stale}` : ""}</span>
    </div>
    <div role="meter" aria-label={`${label}: ${text.remaining}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.remaining}
      className="relative h-6 overflow-hidden rounded-md bg-muted">
      <div aria-hidden="true" className={`absolute inset-y-0 right-0 ${tone}`} style={{ width: `${window.remaining}%` }} />
      <span className="relative flex h-full items-center justify-center px-2 text-xs font-medium tabular-nums">{percent.format(window.remaining)}% {text.remaining}</span>
    </div>
    {untilReset !== null ? <>
      <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{text.reset}</span><span>{formatDate(window.resetsAt!)}</span></div>
      <div className="relative h-5 overflow-hidden rounded-md bg-muted">
        {timePercent !== null ? <div aria-hidden="true" className="absolute inset-y-0 right-0 bg-primary/15" style={{ width: `${timePercent}%` }} /> : null}
        <span className="relative flex h-full items-center justify-center px-2 text-xs tabular-nums">{untilReset === 0 ? text.waiting : formatCountdown(untilReset)}</span>
      </div>
    </> : null}
  </div>;
}
function QuotaDisk() {
  const composer = useComposer();
  if (composer.scope.kind !== "thread" || composer.selection?.providerId !== "codex") return null;
  return <ThreadQuota key={composer.scope.threadId} threadId={composer.scope.threadId} />;
}

function ThreadQuota({ threadId }: { threadId: string }) {
  const { data, now, loading, load } = useQuota(threadId);
  const { values } = useSettings();
  const format = getQuotaFormat(values?.language);
  const { text, percent } = format;
  const origin = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const placed = (event: Event) => {
      const detail = (event as CustomEvent<{ origin: HTMLElement; target: HTMLElement | null }>).detail;
      if (detail?.origin === origin.current) setTarget(detail.target);
    };
    document.addEventListener("codex-quota:footer-placed", placed);
    document.dispatchEvent(new Event("codex-quota:place-footer"));
    return () => document.removeEventListener("codex-quota:footer-placed", placed);
  }, []);
  const account = data?.account;
  const windows = account?.windows ?? [];
  const fresh = !!account && isFresh(account.observedAt, now);
  const current = fresh && windows.length > 0 && !windows.some((w) => w.resetsAt && Date.parse(w.resetsAt) <= now);
  const remaining = current ? Math.min(...windows.map((w) => w.remaining)) : null;
  const label = `${text.title}: ${remaining === null ? text.unavailable : `${percent.format(remaining)}% ${text.remaining}`}`;
  const disk = <QuotaPopover label={label} title={text.title} trigger={
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.18" />
      {remaining !== null ? <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="4" pathLength="100" strokeDasharray={`${remaining} 100`} transform="rotate(-90 12 12)" /> : null}
      {remaining === null ? <text x="12" y="15.5" textAnchor="middle" fontSize="11" fill="currentColor">?</text> : <circle cx="12" cy="12" r="2" fill="currentColor" />}
    </svg>
  }>
    <div className="mb-1 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold">Codex{account?.plan ? ` · ${account.plan}` : ""}</h3>
      <button type="button" disabled={loading} onClick={() => void load(true)} className="rounded-md px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{loading ? text.refreshing : text.refresh}</button>
    </div>
    {data?.error || (account && windows.length === 0) ? <p role="status" className="py-2 text-xs text-muted-foreground">{text.unavailable}</p>
      : account ? windows.map((window) => <WindowRow key={window.id} window={window} fresh={fresh} now={now} format={format} />)
      : <p role="status" className="py-2 text-xs text-muted-foreground">{text.loading}</p>}
  </QuotaPopover>;
  return <><span ref={origin} data-codex-quota-origin="" className="hidden" />{target ? createPortal(disk, target) : null}</>;
}
export default definePluginApp((app) => {
  app.contentScripts.register({ id: "quota-footer", mount: mountUsageFooter });
  app.composer.customize({ id: "quota-disk", scopes: ["thread"], actions: [{ id: "disk", component: QuotaDisk }] });
});
