import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { Quota, rpcContract } from "../server";

// The composer mounts a fresh instance for each Codex thread.
export function useQuota(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now);
  const pending = useRef<{ refresh: boolean } | null>(null);

  const load = useCallback(async (refresh = false) => {
    // A manual refresh supersedes a cached read. Polls never supersede a refresh.
    if (pending.current && (!refresh || pending.current.refresh)) return;
    const request = { refresh };
    pending.current = request;
    setLoading(refresh);
    let result: Quota;
    try {
      result = await rpc.call("quota", { threadId, refresh });
    } catch {
      result = { account: null, error: "refresh_failed" };
    }
    if (pending.current !== request) return;
    pending.current = null;
    setData(result);
    setNow(Date.now());
    setLoading(false);
  }, [rpc, threadId]);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => { if (!document.hidden) void load(); }, 120_000);
    const clock = window.setInterval(() => setNow(Date.now()), 15_000);
    const resume = () => {
      if (!document.hidden) { setNow(Date.now()); void load(); }
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      pending.current = null;
      window.clearInterval(poll);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [load]);
  return { data, loading, now, load };
}
