import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactElement } from "react";
import * as Popover from "@radix-ui/react-popover";
import { experimental_Icon as Icon, useRpc } from "@get-bb/plugin-sdk/app";
import type { Quota, QuotaLocation, rpcContract } from "../server";
import type { getQuotaFormat } from "./format";

type ResetSummary = { count: number | null; expiries?: (number | null)[] };
export type ResetSnapshot = { location: QuotaLocation; sourceKey: string | null; quota: Quota | null };
type ResetProps = ResetSnapshot & { count: number | null | undefined; format: ReturnType<typeof getQuotaFormat> };

// The quota store shares the snapshot object across rings. Weak keys let old
// snapshots and their reset reads be collected together.
type ResetRead = { pending: Promise<ResetSummary>; value?: ResetSummary };
type ResetCache = WeakMap<Quota, Map<string, ResetRead>>;
type LastReset = { sourceKey: string; plan?: string; value: ResetSummary };
const counts: ResetCache = new WeakMap();
const details: ResetCache = new WeakMap();

function resetEntries(cache: ResetCache, quota: Quota) {
  let entries = cache.get(quota);
  if (!entries) { entries = new Map(); cache.set(quota, entries); }
  return entries;
}

function visibleReset(cache: ResetCache, quota: Quota | null, sourceKey: string | null, last?: LastReset) {
  if (!quota || !sourceKey) return undefined;
  return cache.get(quota)?.get(sourceKey)?.value
    ?? (last?.sourceKey === sourceKey && last.plan === quota.account?.plan ? last.value : undefined);
}

function useResetSummary({ location, quota, sourceKey }: ResetSnapshot, { includeExpiries, enabled }: {
  includeExpiries: boolean;
  enabled?: boolean;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const cache = includeExpiries ? details : counts;
  const [last, setLast] = useState<LastReset>();
  useEffect(() => {
    if (enabled === false || !quota || !sourceKey) return;
    let active = true;
    const entries = resetEntries(cache, quota);
    let read = entries.get(sourceKey);
    if (!read) {
      const pending = rpc.call("availableResets", { ...location, expectedSourceKey: sourceKey, includeExpiries })
        .catch(() => ({ count: null }));
      const entry: ResetRead = { pending };
      void pending.then(value => { entry.value = value; });
      entries.set(sourceKey, entry);
      read = entry;
    }
    void read.pending.then(value => { if (active) setLast({ sourceKey, plan: quota.account?.plan, value }); });
    return () => { active = false; };
  }, [rpc, location, sourceKey, quota, includeExpiries, enabled, cache]);
  return visibleReset(cache, quota, sourceKey, last);
}

export function useAvailableResetCount(snapshot: ResetSnapshot, fresh: boolean, enabled = true) {
  const { quota } = snapshot;
  const summary = useResetSummary({ ...snapshot, quota: fresh ? quota : null }, { includeExpiries: false, enabled });
  if (!enabled) return null;
  if (quota && (!quota.account || !fresh)) return null;
  return summary?.count;
}

function ResetExpiries({ summary, format }: { summary: ResetSummary; format: ResetProps["format"] }) {
  const { text } = format;
  if (summary.count === 0) return <>{text.noResets}</>;
  if (!summary.expiries?.length || summary.count === null) return <>{text.unknownExpiry}</>;

  const rows = new Map<number | null, number>();
  const sorted = [...summary.expiries].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
  for (const seconds of sorted) {
    const minute = seconds === null ? null : Math.floor(seconds / 60) * 60;
    rows.set(minute, (rows.get(minute) ?? 0) + 1);
  }
  const missing = summary.count - sorted.length;
  return <ul className="grid gap-1">
    {Array.from(rows, ([seconds, count]) => {
      const expiry = seconds === null ? null : format.formatExpiry(seconds);
      return <li key={seconds ?? "unlimited"} className="flex items-baseline justify-between gap-4">
        <span>{expiry?.date ?? text.noExpiry}{count > 1 && ` × ${count}`}</span>
        {expiry && <span className="whitespace-nowrap text-muted-foreground tabular-nums">{expiry.time}</span>}
      </li>;
    })}
    {missing > 0 && <li className="text-muted-foreground">{text.unknownExpiry}{missing > 1 && ` × ${missing}`}</li>}
  </ul>;
}

const badgeContainer = "-my-3.5 -mr-0.5 ml-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center";

function useResetDetailsInteraction() {
  const [mode, setMode] = useState<"closed" | "hover" | "focus" | "pinned">("closed");
  const timer = useRef<number | undefined>(undefined);
  const pressedWithTouch = useRef(false);
  const cancelTimer = () => window.clearTimeout(timer.current);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function setOpen(open: boolean) {
    cancelTimer();
    setMode(open ? "pinned" : "closed");
  }

  function enterTrigger(event: PointerEvent) {
    if (event.pointerType === "touch") return;
    cancelTimer();
    if (mode !== "closed") return;
    timer.current = window.setTimeout(() => setMode("hover"), 150);
  }

  function leave(event: PointerEvent, keepPreview: boolean) {
    if (event.pointerType === "touch") return;
    cancelTimer();
    if (mode !== "hover") return;
    if (!keepPreview) {
      setMode("closed");
      return;
    }
    // Keep the preview open across the gap between the badge and the details.
    timer.current = window.setTimeout(() => setMode("closed"), 180);
  }

  function focusTrigger() {
    cancelTimer();
    setMode(current => current === "pinned" ? current : "focus");
  }

  function pressTrigger(event: MouseEvent) {
    if (!pressedWithTouch.current || event.detail === 0) return;
    // A tap can focus the button before it clicks. Only the prior tap pins it.
    event.preventDefault();
    setOpen(mode !== "pinned");
  }

  return {
    active: mode !== "closed", pinned: mode === "pinned", setOpen,
    enterTrigger, leave, cancelTimer, focusTrigger, pressTrigger,
    rememberPointer: (event: PointerEvent) => { pressedWithTouch.current = event.pointerType === "touch"; },
  };
}

function keepFocus(event: Event) {
  event.preventDefault();
}

function ResetDetails({ location, quota, sourceKey, format, badge, label }: Omit<ResetProps, "count"> & {
  badge: ReactElement;
  label: string;
}) {
  const interaction = useResetDetailsInteraction();
  const summary = useResetSummary({ location, quota, sourceKey }, {
    includeExpiries: true,
    enabled: interaction.active,
  });
  const open = interaction.active && (interaction.pinned || summary !== undefined);
  return <Popover.Root open={open} onOpenChange={interaction.setOpen}>
    <Popover.Trigger aria-label={label} className={`${badgeContainer} group cursor-pointer focus-visible:outline-none`}
      onPointerEnter={interaction.enterTrigger} onPointerLeave={event => interaction.leave(event, open)}
      onPointerDown={interaction.rememberPointer} onFocus={interaction.focusTrigger} onClick={interaction.pressTrigger}>
      <Popover.Anchor asChild>{badge}</Popover.Anchor>
    </Popover.Trigger>
    <Popover.Content side="top" align="start" sideOffset={4} collisionPadding={8} aria-label={format.text.resets}
      onOpenAutoFocus={keepFocus} onCloseAutoFocus={keepFocus}
      onPointerEnter={interaction.cancelTimer} onPointerLeave={event => interaction.leave(event, true)}
      className="z-50 grid min-w-36 gap-1.5 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md">
      <div className="font-medium">{format.text.resets}</div>
      {summary ? <ResetExpiries summary={summary} format={format} /> : <span role="status">…</span>}
    </Popover.Content>
  </Popover.Root>;
}

export function ResetCount({ count, location, quota, sourceKey, format }: ResetProps) {
  if (count === null) return null;
  const badge = <span className="inline-flex h-4 min-w-10 shrink-0 items-center justify-center gap-1 rounded-full bg-muted px-1.5 text-muted-foreground tabular-nums group-focus-visible:ring-2 group-focus-visible:ring-ring">
    <Icon name="Zap" aria-hidden="true" className="size-3.5" />
    <span className="sr-only">{format.text.manualResets}: </span>{count ?? "–"}
  </span>;
  if (!count) return <span className={`${badgeContainer} pointer-events-none`}>{badge}</span>;
  return <ResetDetails location={location} quota={quota} sourceKey={sourceKey} format={format} badge={badge}
    label={`${format.text.manualResets}: ${count}`} />;
}
