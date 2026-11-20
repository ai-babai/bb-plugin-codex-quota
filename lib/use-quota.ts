import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { QuotaLocation, QuotaProvider, rpcContract } from "../server";

import { QuotaSubscription, quotaLocationKey } from "./quota-store";

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

// Bindings are scope-specific; readings, requests and timers are source-specific.
export function useQuota(location: QuotaLocation, intervalSeconds = 120, confirmedProvider = true) {
  const rpc = useRpc<typeof rpcContract>();
  const key = quotaLocationKey(location);
  const subscription = useMemo(() => new QuotaSubscription(rpc, location, { intervalSeconds, confirmedProvider }), [rpc, key]);
  const snapshot = useSyncExternalStore(subscription.subscribe, subscription.getSnapshot);
  useEffect(() => { subscription.configure({ intervalSeconds, confirmedProvider }); }, [subscription, intervalSeconds, confirmedProvider]);
  return { ...snapshot, load: subscription.load };
}
