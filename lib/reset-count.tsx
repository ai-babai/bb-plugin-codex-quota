import { useEffect, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { experimental_Icon as Icon, useRpc } from "@get-bb/plugin-sdk/app";
import type { Quota, rpcContract } from "../server";
import type { getQuotaFormat } from "./format";

type ResetSummary = { count: number | null; expiries?: (number | null)[] };
type ResetProps = { threadId: string; quota: Quota; format: ReturnType<typeof getQuotaFormat> };

// Reuse each read while the quota snapshot is current, including across hovers.
const counts = new WeakMap<Quota, Promise<ResetSummary>>();
const details = new WeakMap<Quota, Promise<ResetSummary>>();

function useResetSummary(threadId: string, quota: Quota, includeExpiries = false) {
  const rpc = useRpc<typeof rpcContract>();
  const [result, setResult] = useState<{ quota: Quota; summary: ResetSummary } | null>(null);
  useEffect(() => {
    let active = true;
    const cache = includeExpiries ? details : counts;
    let read = cache.get(quota);
    if (!read) {
      read = rpc.call("availableResets", { threadId, includeExpiries }).catch(() => ({ count: null }));
      cache.set(quota, read);
    }
    void read.then(summary => { if (active) setResult({ quota, summary }); });
    return () => { active = false; };
  }, [rpc, threadId, quota, includeExpiries]);
  return result?.quota === quota ? result.summary : undefined;
}

function ResetExpiries({ threadId, quota, format }: ResetProps) {
  const summary = useResetSummary(threadId, quota, true);
  const { text } = format;
  if (!summary) return <>…</>;
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
  const count = useResetSummary(props.threadId, props.quota)?.count;
  if (count == null) return null;
  const badge = <span tabIndex={count > 0 ? 0 : undefined}
    className="inline-flex w-fit shrink-0 items-center gap-1 rounded-sm text-muted-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <Icon name="Zap" aria-hidden="true" className="size-3.5" />
    <span className="sr-only">{props.format.text.manualResets}: </span>{count}
  </span>;
  if (count === 0) return badge;
  return <Tooltip.Provider delayDuration={150}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{badge}</Tooltip.Trigger>
      <Tooltip.Content side="top" align="start" sideOffset={4} collisionPadding={8}
        className="z-50 grid min-w-36 gap-1.5 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md">
        <div className="font-medium">{props.format.text.resets}</div>
        <ResetExpiries {...props} />
      </Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>;
}
