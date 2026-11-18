import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ResetCount, useAvailableResetCount } from "./lib/reset-count";
import { QuotaPopover } from "./lib/quota-popover";
import { definePluginApp, useComposer, useSettings } from "@get-bb/plugin-sdk/app";
import { mountUsageFooter } from "./lib/usage-footer";
import { getQuotaFormat, isFresh } from "./lib/format";
import type { QuotaWindow } from "./server";
import { useQuota } from "./lib/use-quota";

const trackClass = "flex h-1.5 w-full justify-end overflow-hidden rounded-full bg-border";

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
  const tone = !current ? "bg-muted-foreground" : window.remaining <= 10 ? "bg-destructive" : window.remaining <= 25 ? "bg-amber-500" : "bg-emerald-500";
  const remainingLabel = `${percent.format(window.remaining)}% ${text.remaining}`;
  return <div className="grid gap-2">
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
      <span className="min-w-0 wrap-anywhere">{label}</span>
      <span className="font-medium tabular-nums" title={`${percent.format(100 - window.remaining)}% ${text.used}`}>
        {remainingLabel}{!current ? ` · ${text.stale}` : ""}
      </span>
    </div>
    <div role="meter" aria-label={`${label}: ${text.remaining}`} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={window.remaining} aria-valuetext={remainingLabel} className={trackClass}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${window.remaining}%` }} />
    </div>
    {untilReset !== null && <div className="grid gap-1 text-muted-foreground tabular-nums">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        {untilReset > 0 ? <>
          <span>{text.resetsIn}</span>
          <span className="ml-auto font-medium text-popover-foreground">{formatCountdown(untilReset)}</span>
        </> : <span>{text.waiting}</span>}
      </div>
      {timePercent !== null && <div aria-hidden="true" className={trackClass}>
        <div className="h-full rounded-full bg-muted-foreground/50" style={{ width: `${timePercent}%` }} />
      </div>}
      <time className="text-end" dateTime={window.resetsAt!}>{formatDate(window.resetsAt!)}</time>
    </div>}
  </div>;
}
function QuotaDisk() {
  const composer = useComposer();
  if (composer.scope.kind !== "thread" || composer.selection?.providerId !== "codex") return null;
  return <ThreadQuota key={composer.scope.threadId} threadId={composer.scope.threadId} />;
}

function ThreadQuota({ threadId }: { threadId: string }) {
  const { values } = useSettings();
  const interval = values?.refreshIntervalSeconds;
  const { data, now, load } = useQuota(threadId, typeof interval === "number" ? interval : undefined);
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
  const count = useAvailableResetCount(threadId, data, fresh);
  const current = fresh && windows.length > 0 && !windows.some((w) => w.resetsAt && Date.parse(w.resetsAt) <= now);
  const remaining = current ? Math.min(...windows.map((w) => w.remaining)) : null;
  const label = `${text.title}: ${remaining === null ? text.unavailable : `${percent.format(remaining)}% ${text.remaining}`}`;
  const disk = <QuotaPopover label={label} title={text.title} onRefresh={input => {
    if ((input === "hover" ? values?.refreshOnHover : values?.refreshOnPress) !== false) void load(true);
  }} trigger={
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.18" />
      {remaining !== null ? <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="4" pathLength="100" strokeDasharray={`${remaining} 100`} transform="rotate(-90 12 12)" /> : null}
      {remaining === null ? <text x="12" y="15.5" textAnchor="middle" fontSize="11" fill="currentColor">?</text> : <circle cx="12" cy="12" r="2" fill="currentColor" />}
    </svg>
  }>
    <div className="flex items-center gap-2">
      <h3 className="min-w-0 wrap-anywhere font-medium">Codex{account?.plan ? ` · ${account.plan}` : ""}</h3>
      <ResetCount key={account?.plan} threadId={threadId} quota={data} count={count} format={format} />
    </div>
    {data?.error || (account && windows.length === 0) ? <p role="status" className="text-muted-foreground">{text.unavailable}</p>
      : account ? windows.map(window => <WindowRow key={window.id} window={window} fresh={fresh} now={now} format={format} />)
      : <p role="status" className="text-muted-foreground">{text.loading}</p>}
  </QuotaPopover>;
  return <><span ref={origin} data-codex-quota-origin="" className="hidden" />{target ? createPortal(disk, target) : null}</>;
}
export default definePluginApp((app) => {
  app.contentScripts.register({ id: "quota-footer", mount: mountUsageFooter });
  app.composer.customize({ id: "quota-disk", scopes: ["thread"], actions: [{ id: "disk", component: QuotaDisk }] });
});
