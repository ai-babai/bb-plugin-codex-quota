import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ResetCount, useAvailableResetCount, type ResetSnapshot } from "./lib/reset-count";
import { environmentLocation, registerSidebarQuota, useStableLocation } from "./lib/sidebar-quota";
import { QuotaSettingsCard } from "./lib/quota-settings";
import { QuotaPopover } from "./lib/quota-popover";
import { definePluginApp, useComposer, useSettings } from "@get-bb/plugin-sdk/app";
import { mountUsageFooter } from "./lib/usage-footer";
import { getQuotaFormat, isFresh } from "./lib/format";
import type { Quota, QuotaLocation, QuotaProvider, QuotaWindow } from "./server";
import { useQuota, useQuotaProviders } from "./lib/use-quota";

// Every window uses the same full-width, right-anchored track, so bars compare
// directly and deplete from left to right.
const trackClass = "flex h-2 w-full justify-end overflow-hidden rounded-full bg-border";

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

/** One line: countdown first, the exact reset date after it. */
function ResetTime({ date, until, format }: { date: string; until: number; format: QuotaFormat }) {
  const { text, formatDate, formatCountdown } = format;
  return <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-muted-foreground tabular-nums">
    {until > 0
      ? <span><span>{text.resetsIn}</span> <span className="font-medium text-popover-foreground">{formatCountdown(until)}</span></span>
      : <span>{text.waiting}</span>}
    <time className="ml-auto" dateTime={date}>{formatDate(date)}</time>
  </div>;
}

/** Share of the window's time still ahead, on the same right-anchored scale as the quota. */
function timeLeftPercent(until: number, hours: number | undefined) {
  if (hours === undefined || !(until > 0)) return null;
  return Math.min(100, until / (hours * 3_600_000) * 100);
}

function QuotaBar({ label, remaining, remainingLabel, tone, timeLeft }: {
  label: string; remaining: number; remainingLabel: string; tone: string; timeLeft: number | null;
}) {
  return <div className="relative">
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={remaining} aria-valuetext={remainingLabel} className={trackClass}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${remaining}%` }} />
    </div>
    {/* Even-pace marker: a fill reaching past it means quota outlasts the window. */}
    {timeLeft !== null && <span aria-hidden="true" data-codex-quota-pace=""
      className="pointer-events-none absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-popover-foreground/70 ring-1 ring-popover"
      style={{ left: `${100 - timeLeft}%` }} />}
  </div>;
}

/** The number reads first; the unit and any staleness note stay secondary. */
function RemainingAmount({ amount, used, current, text }: {
  amount: string; used: string; current: boolean; text: QuotaFormat["text"];
}) {
  return <span className="tabular-nums" data-codex-quota-remaining="" title={used}>
    <span className={`text-sm leading-none font-semibold ${current ? "" : "text-muted-foreground"}`}>{amount}</span>
    <span className="text-muted-foreground"> {text.remaining}{current ? "" : ` · ${text.stale}`}</span>
  </span>;
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
  const amount = `${percent.format(window.remaining)}%`;
  return <div className="grid gap-1.5">
    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
      <span className="min-w-0 wrap-anywhere">{label}</span>
      <RemainingAmount amount={amount} used={`${percent.format(100 - window.remaining)}% ${text.used}`} current={current} text={text} />
    </div>
    <QuotaBar label={`${label}: ${text.remaining}`} remaining={window.remaining} remainingLabel={`${amount} ${text.remaining}`}
      tone={tone} timeLeft={timeLeftPercent(until, standard?.hours)} />
    {window.resetsAt && Number.isFinite(until) && <ResetTime date={window.resetsAt} until={until} format={format} />}
  </div>;
}

function DraftQuotaDisk() {
  const { selection } = useComposer();
  const { values } = useSettings();
  const environment = selection?.environment;
  const providerId = selection?.providerId;
  const providers = useQuotaProviders(providerId, values?.showInChat !== false);
  const scope = environmentLocation(environment);
  const location = useStableLocation(scope && providerId ? { ...scope, providerId } : null);
  const provider = providers.find(item => item.id === providerId);
  if (!location || !provider) return null;
  return <QuotaFooter key={JSON.stringify(location)} location={location} provider={provider} />;
}

function QuotaDisk() {
  const composer = useComposer();
  const { values } = useSettings();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const providerId = composer.selection?.providerId;
  const providers = useQuotaProviders(`${providerId}:${threadId}`, values?.showInChat !== false);
  const location = useMemo(() => threadId && providerId ? { threadId, providerId } : null, [threadId, providerId]);
  const provider = providers.find(item => item.id === providerId);
  if (!location || !provider) return null;
  return <QuotaFooter key={JSON.stringify(location)} location={location} provider={provider} />;
}

function QuotaFooter({ location, provider }: { location: QuotaLocation; provider: QuotaProvider }) {
  const { values } = useSettings();
  return values?.showInChat === false ? null : <ChatRing location={location} provider={provider} />;
}

function ChatRing({ location, provider }: { location: QuotaLocation; provider: QuotaProvider }) {
  const { origin, target } = useFooterTarget();
  return <><span ref={origin} data-codex-quota-origin="" className="hidden" />{target &&
    createPortal(<ComposerQuota location={location} provider={provider} />, target)}</>;
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

function QuotaWindows({ data, loading, now, fresh, format }: {
  data: Quota | null; loading: boolean; now: number; fresh: boolean; format: QuotaFormat;
}) {
  if (loading) {
    return <p role="status" className="text-muted-foreground">{format.text.loading}</p>;
  }
  if (data?.error || !data?.account?.windows.length) {
    return <p role="status" className="text-muted-foreground">{format.text.unavailable}</p>;
  }
  return <div className="grid gap-3">{data.account.windows.map(window =>
    <WindowRow key={window.id} window={window} fresh={fresh} now={now} format={format} />)}</div>;
}

function QuotaRing({ remaining, loading }: { remaining: number | null; loading: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="4" opacity="0.18" />
    {loading && <circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
      pathLength="100" strokeDasharray="32 100" className="origin-center motion-safe:animate-spin" />}
    {!loading && remaining === null && <text x="12" y="15.5" textAnchor="middle" fontSize="12" fontWeight="600" fill="currentColor">?</text>}
    {remaining !== null && <>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="4"
        pathLength="100" strokeDasharray={`${remaining} 100`} transform="rotate(-90 12 12)" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </>}
  </svg>;
}

type QuotaSurface = "chat" | "sidebar";

function ComposerQuota({ location, provider, surface = "chat", confirmedProvider = true }: { location: QuotaLocation; provider: QuotaProvider; surface?: QuotaSurface; confirmedProvider?: boolean }) {
  const { values } = useSettings();
  const interval = values?.refreshIntervalSeconds;
  const { data, now, load, loading, sourceKey } = useQuota(location, typeof interval === "number" ? interval : undefined, confirmedProvider);
  const fresh = isFresh(data?.account?.observedAt ?? null, now);
  const snapshot = { location, sourceKey, quota: data };
  const count = useAvailableResetCount(snapshot, fresh, provider.capabilities.resets);
  return <QuotaCard surface={surface} provider={provider} snapshot={snapshot} loading={loading && data === null} now={now} fresh={fresh} count={count}
    format={getQuotaFormat(values?.language, provider.label)} onRefresh={input => {
      const enabled = input === "hover" ? values?.refreshOnHover : values?.refreshOnPress;
      if (enabled !== false) void load(true);
    }} />;
}

function QuotaCard({ snapshot, loading, surface, provider, now, fresh, count, format, onRefresh }: {
  surface: QuotaSurface;
  provider: QuotaProvider;
  snapshot: ResetSnapshot; loading: boolean; now: number; fresh: boolean;
  count: number | null | undefined; format: QuotaFormat; onRefresh: (input: "hover" | "press") => void;
}) {
  const { text, percent } = format;
  const { quota: data, sourceKey } = snapshot;
  const account = data?.account;
  const windows = account?.windows ?? [];
  const remaining = remainingQuota(windows, fresh, now);
  const status = loading ? text.loading : text.unavailable;
  const label = `${text.title}: ${remaining === null ? status : `${percent.format(remaining)}% ${text.remaining}`}`;
  const showResets = provider.capabilities.resets && (loading || (data !== null && sourceKey !== null));
  return <QuotaPopover surface={surface} label={label} title={text.title} onRefresh={onRefresh}
    trigger={<QuotaRing remaining={remaining} loading={loading} />}>
    <QuotaSettingsCard surface={surface}>{settingsButton => <>
      <div className="flex items-center gap-1">
        {settingsButton}
        <h3 className="mr-auto min-w-0 wrap-anywhere font-medium">{provider.label}{account?.plan ? ` · ${account.plan}` : ""}</h3>
        {showResets &&
          <ResetCount key={JSON.stringify([sourceKey, account?.plan])} {...snapshot} count={count} format={format} />}
      </div>
      <QuotaWindows data={data} loading={loading} now={now} fresh={fresh} format={format} />
    </>}</QuotaSettingsCard>
  </QuotaPopover>;
}
export default definePluginApp((app) => {
  registerSidebarQuota(app, ComposerQuota);
  app.composer.customize({ id: "draft-quota", scopes: ["new-thread"], banners: [{ id: "disk", chrome: "bare", component: DraftQuotaDisk }] });
  app.contentScripts.register({ id: "quota-footer", mount: mountUsageFooter });
  app.composer.customize({ id: "quota-disk", scopes: ["thread"], banners: [{ id: "disk", chrome: "bare", component: QuotaDisk }] });
});
