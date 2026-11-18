import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ResetCount, useAvailableResetCount } from "./lib/reset-count";
import { QuotaPopover } from "./lib/quota-popover";
import { definePluginApp, type ComposerSelection, useComposer, useSettings } from "@get-bb/plugin-sdk/app";
import { mountUsageFooter } from "./lib/usage-footer";
import { getQuotaFormat, isFresh } from "./lib/format";
import type { Quota, QuotaLocation, QuotaWindow } from "./server";
import { useQuota } from "./lib/use-quota";

const trackClass = "flex h-1.5 w-full justify-end overflow-hidden rounded-full bg-border";

type QuotaFormat = ReturnType<typeof getQuotaFormat>;

const standardWindows = {
  "five-hour": { label: "fiveHour", hours: 5 },
  daily: { label: "daily", hours: 24 },
  weekly: { label: "weekly", hours: 168 },
} as const;

function remainingColor(remaining: number, current: boolean) {
  if (!current) return "bg-muted-foreground";
  if (remaining <= 10) return "bg-destructive";
  if (remaining <= 25) return "bg-amber-500";
  return "bg-emerald-500";
}

function ResetTime({ date, until, hours, format }: {
  date: string; until: number; hours?: number; format: QuotaFormat;
}) {
  const { text, formatDate, formatCountdown } = format;
  const timePercent = hours === undefined ? null : Math.min(100, Math.max(0, until) / (hours * 3_600_000) * 100);
  return <div className="grid gap-1 text-muted-foreground tabular-nums">
    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
      {until > 0 ? <>
        <span>{text.resetsIn}</span>
        <span className="ml-auto font-medium text-popover-foreground">{formatCountdown(until)}</span>
      </> : <span>{text.waiting}</span>}
    </div>
    {timePercent !== null && <div aria-hidden="true" className={trackClass}>
      <div className="h-full rounded-full bg-muted-foreground/50" style={{ width: `${timePercent}%` }} />
    </div>}
    <time className="text-end" dateTime={date}>{formatDate(date)}</time>
  </div>;
}

function WindowRow({ window, fresh, now, format }: {
  window: QuotaWindow; fresh: boolean; now: number; format: QuotaFormat;
}) {
  const { text, percent } = format;
  const standard = window.kind === "custom" ? undefined : standardWindows[window.kind];
  const label = standard ? text[standard.label] : window.label;
  const until = window.resetsAt ? Date.parse(window.resetsAt) - now : NaN;
  const current = fresh && (Number.isNaN(until) || until > 0);
  const tone = remainingColor(window.remaining, current);
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
    {window.resetsAt && Number.isFinite(until) &&
      <ResetTime date={window.resetsAt} until={until} hours={standard?.hours} format={format} />}
  </div>;
}

function draftLocation(environment: ComposerSelection["environment"]): QuotaLocation | null {
  switch (environment?.type) {
    case "reuse": return { environmentId: environment.environmentId };
    case "host": return environment.hostId ? { hostId: environment.hostId } : null;
    case "provider": return environment.machine?.type === "existing" ? { hostId: environment.machine.hostId } : null;
    default: return null;
  }
}

function DraftQuotaDisk() {
  const { selection } = useComposer();
  const environment = selection?.environment;
  const location = useMemo(() => draftLocation(environment), [environment]);
  if (!location || selection?.providerId !== "codex") return null;
  return <QuotaFooter key={JSON.stringify(location)} location={location} />;
}

function QuotaDisk() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const location = useMemo(() => threadId ? { threadId } : null, [threadId]);
  if (!location || composer.selection?.providerId !== "codex") return null;
  return <QuotaFooter key={threadId} location={location} />;
}

function QuotaFooter({ location }: { location: QuotaLocation }) {
  const { origin, target } = useFooterTarget();
  return <><span ref={origin} data-codex-quota-origin="" className="hidden" />{target &&
    createPortal(<ComposerQuota location={location} />, target)}</>;
}

function useFooterTarget() {
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
  return { origin, target };
}

function remainingQuota(windows: QuotaWindow[], fresh: boolean, now: number) {
  if (!fresh || windows.length === 0) return null;
  if (windows.some(w => w.resetsAt && Date.parse(w.resetsAt) <= now)) return null;
  return Math.min(...windows.map(w => w.remaining));
}

function QuotaWindows({ data, now, fresh, format }: {
  data: Quota | null; now: number; fresh: boolean; format: QuotaFormat;
}) {
  if (!data || (!data.error && !data.account)) {
    return <p role="status" className="text-muted-foreground">{format.text.loading}</p>;
  }
  if (data.error || !data.account?.windows.length) {
    return <p role="status" className="text-muted-foreground">{format.text.unavailable}</p>;
  }
  return data.account.windows.map(window =>
    <WindowRow key={window.id} window={window} fresh={fresh} now={now} format={format} />);
}

function QuotaRing({ remaining }: { remaining: number | null }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.18" />
    {remaining === null
      ? <text x="12" y="15.5" textAnchor="middle" fontSize="11" fill="currentColor">?</text>
      : <>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="4"
          pathLength="100" strokeDasharray={`${remaining} 100`} transform="rotate(-90 12 12)" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
      </>}
  </svg>;
}

function ComposerQuota({ location }: { location: QuotaLocation }) {
  const { values } = useSettings();
  const interval = values?.refreshIntervalSeconds;
  const { data, now, load } = useQuota(location, typeof interval === "number" ? interval : undefined);
  const fresh = isFresh(data?.account?.observedAt ?? null, now);
  const count = useAvailableResetCount(location, data, fresh);
  return <QuotaCard location={location} data={data} now={now} fresh={fresh} count={count}
    format={getQuotaFormat(values?.language)} onRefresh={input => {
      const enabled = input === "hover" ? values?.refreshOnHover : values?.refreshOnPress;
      if (enabled !== false) void load(true);
    }} />;
}

function QuotaCard({ location, data, now, fresh, count, format, onRefresh }: {
  location: QuotaLocation; data: Quota | null; now: number; fresh: boolean;
  count: number | null | undefined; format: QuotaFormat; onRefresh: (input: "hover" | "press") => void;
}) {
  const { text, percent } = format;
  const account = data?.account;
  const windows = account?.windows ?? [];
  const remaining = remainingQuota(windows, fresh, now);
  const label = `${text.title}: ${remaining === null ? text.unavailable : `${percent.format(remaining)}% ${text.remaining}`}`;
  return <QuotaPopover label={label} title={text.title} onRefresh={onRefresh} trigger={<QuotaRing remaining={remaining} />}>
    <div className="flex items-center gap-2">
      <h3 className="min-w-0 wrap-anywhere font-medium">Codex{account?.plan ? ` · ${account.plan}` : ""}</h3>
      <ResetCount key={account?.plan} location={location} quota={data} count={count} format={format} />
    </div>
    <QuotaWindows data={data} now={now} fresh={fresh} format={format} />
  </QuotaPopover>;
}
export default definePluginApp((app) => {
  app.composer.customize({ id: "draft-quota", scopes: ["new-thread"], banners: [{ id: "disk", chrome: "bare", component: DraftQuotaDisk }] });
  app.contentScripts.register({ id: "quota-footer", mount: mountUsageFooter });
  app.composer.customize({ id: "quota-disk", scopes: ["thread"], banners: [{ id: "disk", chrome: "bare", component: QuotaDisk }] });
});
