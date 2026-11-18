import { useEffect, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { experimental_Icon as Icon, useRpc } from "@get-bb/plugin-sdk/app";
import type { Quota, rpcContract } from "../server";
import type { getQuotaFormat } from "./format";

type ResetSummary = { count: number | null; expiries?: (number | null)[] };
type ResetProps = { threadId: string; quota: Quota | null; count: number | null | undefined; format: ReturnType<typeof getQuotaFormat> };

// Reuse each read while the quota snapshot is current, including across hovers.
type ResetRead = { pending: Promise<ResetSummary>; value?: ResetSummary };
const counts = new WeakMap<Quota, ResetRead>();
const details = new WeakMap<Quota, ResetRead>();

function useResetSummary(threadId: string, quota: Quota | null, includeExpiries = false, enabled = true) {
  const rpc = useRpc<typeof rpcContract>();
  const cache = includeExpiries ? details : counts;
  const plan = quota?.account?.plan;
  const [last, setLast] = useState<{ threadId: string; plan?: string; value: ResetSummary }>();
  useEffect(() => {
    if (!enabled || !quota) return;
    let active = true;
    let read = cache.get(quota);
    if (!read) {
      const pending = rpc.call("availableResets", { threadId, includeExpiries }).catch(() => ({ count: null }));
      const entry: ResetRead = { pending };
      void pending.then(value => { entry.value = value; });
      cache.set(quota, entry);
      read = entry;
    }
    void read.pending.then(value => { if (active) setLast({ threadId, plan, value }); });
    return () => { active = false; };
  }, [rpc, threadId, quota, plan, includeExpiries, enabled, cache]);
  if (!quota) return undefined;
  return cache.get(quota)?.value ?? (last?.threadId === threadId && last.plan === plan ? last.value : undefined);
}

export function useAvailableResetCount(threadId: string, quota: Quota | null, fresh: boolean) {
  const summary = useResetSummary(threadId, fresh ? quota : null);
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

export function ResetCount(props: ResetProps) {
  const { count } = props;
  const [open, setOpen] = useState(false);
  const summary = useResetSummary(props.threadId, props.quota, true, open && count != null && count > 0);
  if (count === null) return null;
  const badge = <span tabIndex={count ? 0 : undefined}
    onPointerLeave={() => { if (!summary) setOpen(false); }}
    className="ml-auto inline-flex h-4 min-w-10 shrink-0 items-center justify-center gap-1 rounded-full bg-muted px-1.5 text-muted-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <Icon name="Zap" aria-hidden="true" className="size-3.5" />
    <span className="sr-only">{props.format.text.manualResets}: </span>{count ?? "–"}
  </span>;
  if (!count) return badge;
  return <Tooltip.Provider delayDuration={150}>
    <Tooltip.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Trigger asChild>{badge}</Tooltip.Trigger>
      {summary && <Tooltip.Content side="top" align="start" sideOffset={4} collisionPadding={8}
        className="z-50 grid min-w-36 gap-1.5 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md">
        <div className="font-medium">{props.format.text.resets}</div>
        <ResetExpiries summary={summary} format={props.format} />
      </Tooltip.Content>}
    </Tooltip.Root>
  </Tooltip.Provider>;
}
