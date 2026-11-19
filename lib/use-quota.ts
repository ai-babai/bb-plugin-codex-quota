import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { Quota, QuotaLocation, QuotaProvider, rpcContract } from "../server";

type QuotaRpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type Registry = { providers?: QuotaProvider[]; pending?: Promise<void>; listeners: Set<() => void> };
const registries = new WeakMap<QuotaRpc, Registry>();
const noProviders: QuotaProvider[] = [];

function registryFor(rpc: QuotaRpc) {
  let registry = registries.get(rpc);
  if (!registry) {
    registry = { listeners: new Set() };
    registries.set(rpc, registry);
  }
  return registry;
}

function readProviders(rpc: QuotaRpc, registry: Registry) {
  if (registry.providers || registry.pending) return;
  registry.pending = rpc.call("listProviders", {}).then(({ providers }) => {
    registry.providers = providers;
    for (const notify of registry.listeners) notify();
  }).catch(() => {
    // Failed discovery is not cached: the next client event/selection retries.
  }).finally(() => { registry.pending = undefined; });
}

/** Share successful discovery and in-flight reads within this plugin client. */
export function useQuotaProviders(selectionKey?: string, enabled = true) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const registry = registryFor(rpc);
  const [, changed] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const notify = () => changed(value => value + 1);
    const resume = () => { if (!document.hidden) readProviders(rpc, registry); };
    registry.listeners.add(notify);
    readProviders(rpc, registry);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      registry.listeners.delete(notify);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [rpc, registry, connection, selectionKey, enabled]);
  return registry.providers ?? noProviders;
}

// The composer and sidebar can mount at different times and have distinct RPC
// wrappers. One provider read serves both for the lifetime of the open scope.
type Startup = { users: number; pending?: Promise<Quota> };
const startups = new Map<string, Startup>();

function joinStartup(key: string, read: () => Promise<Quota>) {
  let startup = startups.get(key);
  if (!startup) {
    const entry: Startup = { users: 0 };
    entry.pending = read().finally(() => { entry.pending = undefined; });
    startups.set(key, entry);
    startup = entry;
  }
  startup.users++;
  return {
    pending: startup.pending,
    leave() {
      startup.users--;
      // React can replay an effect immediately after cleanup.
      queueMicrotask(() => {
        if (startup.users === 0 && startups.get(key) === startup) startups.delete(key);
      });
    },
  };
}

// Scope + provider identity isolates visible data, including before effects run.
export function useQuota(location: QuotaLocation, intervalSeconds = 120, confirmedProvider = true) {
  const rpc = useRpc<typeof rpcContract>();
  const key = JSON.stringify(location);
  const [snapshot, setSnapshot] = useState<{ key: string; data: Quota } | null>(null);
  const [now, setNow] = useState(Date.now);
  const pending = useRef<{ refresh: boolean } | null>(null);

  const load = useCallback(async (refresh = false, shared?: Promise<Quota>) => {
    // A manual refresh supersedes a cached read. Polls never supersede a refresh.
    if (pending.current && (!refresh || pending.current.refresh)) return;
    const request = { refresh };
    pending.current = request;
    let result: Quota;
    try {
      result = await (shared ?? rpc.call("quota", { ...location, refresh }));
    } catch {
      result = { account: null, error: "refresh_failed" };
    }
    if (pending.current !== request) return;
    pending.current = null;
    setSnapshot({ key, data: result });
    setNow(Date.now());
  }, [rpc, location, key]);

  useEffect(() => {
    const startup = confirmedProvider && location.providerId === "codex"
      ? joinStartup(key, async () => rpc.call("quota", { ...location, refresh: true })) : undefined;
    void load(Boolean(startup?.pending), startup?.pending);
    const clock = window.setInterval(() => setNow(Date.now()), 15_000);
    const resume = () => {
      if (!document.hidden) { setNow(Date.now()); void load(); }
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      startup?.leave();
      pending.current = null;
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [confirmedProvider, key, load, location, rpc]);
  useEffect(() => {
    if (intervalSeconds === 0) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true);
    }, intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [load, intervalSeconds]);

  return { data: snapshot?.key === key ? snapshot.data : null, now, load };
}
