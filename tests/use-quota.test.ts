// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { createContext, createElement, useContext, type PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useQuota, useQuotaProviders } from "../lib/use-quota";
import type { Quota } from "../server";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
type TestRpcClient = { call: typeof rpc.call };
const client = vi.hoisted(() => ({ current: {} as TestRpcClient }));
const rpcContext = createContext<TestRpcClient | null>(null);
const location = { threadId: "thread-a" };
const codex = { ...location, providerId: "codex" };
let serial = 0;
let sourceKey: string;
let response: Quota;

vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => useContext(rpcContext) ?? client.current,
  useRealtimeConnectionState: () => "connected",
}));

function rpcWrapper() {
  const value = { call: rpc.call };
  return ({ children }: PropsWithChildren) => createElement(rpcContext.Provider, { value }, children);
}
function quota(remaining = 75): Quota {
  return { error: null, account: { plan: "Pro", observedAt: Date.now(), windows: [
    { id: "window", kind: "custom", label: "Budget", remaining, resetsAt: null },
  ] } };
}
const reads = () => rpc.call.mock.calls.filter(([method]) => method === "quota");
const resolutions = () => rpc.call.mock.calls.filter(([method]) => method === "resolveSource");
const settle = () => act(async () => {});
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  client.current = { call: rpc.call };
  sourceKey = `opaque-source-${++serial}`;
  response = quota();
  rpc.call.mockImplementation(async method => method === "resolveSource" ? { sourceKey } : response);
});
afterEach(() => {
  cleanup(); rpc.call.mockReset(); vi.restoreAllMocks(); vi.useRealTimers();
});

it("shares the exact snapshot and one startup refresh across scopes and RPC wrappers", async () => {
  const host = renderHook(() => useQuota({ hostId: "machine", providerId: "codex" }, 0), { wrapper: rpcWrapper() });
  const thread = renderHook(() => useQuota(codex, 0), { wrapper: rpcWrapper() });
  const sidebar = renderHook(() => useQuota({ environmentId: "env", providerId: "codex" }, 0), { wrapper: rpcWrapper() });
  expect(host.result.current.loading).toBe(true);
  expect(host.result.current.data).toBeNull();
  await settle();
  expect(reads()).toHaveLength(1);
  expect(reads()[0][1]).toEqual({ hostId: "machine", providerId: "codex", refresh: true, expectedSourceKey: sourceKey });
  for (const view of [host, thread, sidebar]) {
    expect(view.result.current.data).toBe(response);
    expect(view.result.current.sourceKey).toBe(sourceKey);
    expect(view.result.current.loading).toBe(false);
  }
  response = quota(40);
  await act(() => sidebar.result.current.load(true));
  expect(reads()).toHaveLength(2);
  expect(thread.result.current.data).toBe(response);
  expect(host.result.current.data).toBe(response);
});

it("retains fresh quota across draft to thread unmount without another startup read", async () => {
  vi.useFakeTimers();
  const draft = renderHook(() => useQuota({ hostId: "machine", providerId: "codex" }, 0));
  await settle();
  const snapshot = draft.result.current.data;
  draft.unmount();
  expect(vi.getTimerCount()).toBe(0);
  await advance(2000);
  const thread = renderHook(() => useQuota(codex, 0));
  expect(thread.result.current.data).toBeNull();
  expect(thread.result.current.sourceKey).toBeNull();
  await settle();
  expect(thread.result.current.data).toBe(snapshot);
  expect(thread.result.current.now).toBe(Date.now());
  expect(reads()).toHaveLength(1);
});

it("expires retained readings after five minutes and after quota window reset", async () => {
  vi.useFakeTimers();
  response.account!.windows[0].resetsAt = new Date(Date.now() + 1000).toISOString();
  const first = renderHook(() => useQuota(codex, 0));
  await settle(); first.unmount();
  await advance(1001);
  response = quota(55);
  const reset = renderHook(() => useQuota(codex, 0));
  await settle();
  expect(reset.result.current.data).toBe(response);
  expect(reads()).toHaveLength(2);
  reset.unmount();
  await advance(5 * 60_000);
  response = quota(80);
  const expired = renderHook(() => useQuota(codex, 0));
  await settle();
  expect(expired.result.current.data).toBe(response);
  expect(reads()).toHaveLength(3);
});

it("bounds inactive source retention and re-reads an evicted source", async () => {
  const firstKey = sourceKey;
  for (let index = 0; index < 33; index++) {
    sourceKey = `${firstKey}-${index}`;
    const view = renderHook(() => useQuota({ hostId: `machine-${index}`, providerId: "third-party" }, 0));
    await settle(); view.unmount();
  }
  const count = reads().length;
  sourceKey = `${firstKey}-0`;
  response = quota(99);
  const returned = renderHook(() => useQuota({ hostId: "machine-0", providerId: "third-party" }, 0));
  await settle();
  expect(reads()).toHaveLength(count + 1);
  expect(returned.result.current.data).toBe(response);
});

it("uses one clock and the shortest enabled poll, updates all surfaces and stops on unmount", async () => {
  vi.useFakeTimers();
  const first = renderHook(({ seconds }) => useQuota(codex, seconds), { initialProps: { seconds: 120 } });
  const second = renderHook(() => useQuota({ ...codex }, 60), { wrapper: rpcWrapper() });
  await settle();
  expect(vi.getTimerCount()).toBe(2);
  await advance(60_000);
  expect(reads()).toHaveLength(2);
  expect(first.result.current.now).toBe(second.result.current.now);
  await act(async () => first.rerender({ seconds: 30 }));
  await advance(30_000);
  expect(reads()).toHaveLength(3);
  first.unmount(); second.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("stops polling at zero and resumes a visible source with one cached read", async () => {
  vi.useFakeTimers();
  const view = renderHook(({ seconds }) => useQuota(codex, seconds), { initialProps: { seconds: 2 } });
  await settle();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await advance(4000);
  expect(reads()).toHaveLength(1);
  hidden.mockReturnValue(false);
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(reads()).toHaveLength(2);
  expect(reads()[1][1].refresh).toBe(false);
  await act(async () => view.rerender({ seconds: 0 }));
  await advance(240_000);
  expect(reads()).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(1);
});

it("refreshes once for a different confirmed Codex thread while sharing cached data immediately", async () => {
  const first = renderHook(() => useQuota(codex, 0));
  await settle();
  const cached = first.result.current.data;
  let finish!: (value: Quota) => void;
  rpc.call.mockImplementation(async method => method === "resolveSource" ? { sourceKey }
    : new Promise<Quota>(resolve => { finish = resolve; }));
  const next = { ...codex, threadId: "thread-b" };
  const second = renderHook(() => useQuota(next, 0));
  await settle();
  expect(second.result.current.data).toBe(cached);
  expect(second.result.current.loading).toBe(false);
  expect(reads()).toHaveLength(2);
  expect(reads()[1][1].refresh).toBe(true);
  const sidebar = renderHook(() => useQuota({ ...next }, 0), { wrapper: rpcWrapper() });
  await settle();
  expect(reads()).toHaveLength(2);
  response = quota(91);
  await act(async () => finish(response));
  for (const view of [first, second, sidebar]) expect(view.result.current.data).toBe(response);
});

it("keeps fallback startup cached, then upgrades pending fallback when Codex is confirmed", async () => {
  let finishCached!: (value: Quota) => void;
  rpc.call.mockImplementation(async (method, input) => {
    if (method === "resolveSource") return { sourceKey };
    return input.refresh ? response : new Promise<Quota>(resolve => { finishCached = resolve; });
  });
  const fallback = renderHook(() => useQuota(codex, 0, false));
  await settle();
  const confirmed = renderHook(() => useQuota({ ...codex }, 0, true));
  await settle();
  expect(reads().map(([, input]) => input.refresh)).toEqual([false, true]);
  expect(confirmed.result.current.data).toBe(response);
  await act(async () => finishCached(quota(3)));
  expect(fallback.result.current.data).toBe(response);
});

it("re-resolves identity on manual refresh and ignores a late response from the previous source", async () => {
  const view = renderHook(() => useQuota(codex, 0));
  await settle();
  let finishOld!: (value: Quota) => void;
  const oldKey = sourceKey;
  rpc.call.mockImplementation(async (method, input) => {
    if (method === "resolveSource") return { sourceKey };
    return input.expectedSourceKey === oldKey ? new Promise<Quota>(resolve => { finishOld = resolve; }) : response;
  });
  let oldRead!: Promise<void>;
  act(() => { oldRead = view.result.current.load(true); });
  await settle();
  sourceKey += "-switched";
  response = quota(23);
  await act(() => view.result.current.load(true));
  expect(view.result.current.sourceKey).toBe(sourceKey);
  expect(view.result.current.data).toBe(response);
  await act(async () => { finishOld(quota(1)); await oldRead; });
  expect(view.result.current.data).toBe(response);
});

it("ignores late identity resolution superseded by a manual request", async () => {
  let finishOld!: (value: { sourceKey: string }) => void;
  rpc.call.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  const view = renderHook(() => useQuota(codex, 0));
  sourceKey += "-new";
  await act(() => view.result.current.load(true));
  await act(async () => finishOld({ sourceKey: "old-opaque-key" }));
  expect(view.result.current.sourceKey).toBe(sourceKey);
  expect(view.result.current.data).toBe(response);
});

it("ignores an old resume resolver when a newer guarded manual refresh changes identity", async () => {
  const view = renderHook(() => useQuota(codex, 0));
  await settle();
  let finishOld!: (value: { sourceKey: string }) => void;
  rpc.call.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  let resume!: Promise<void>;
  act(() => { resume = view.result.current.load(false); });
  sourceKey += "-new";
  response = quota(12);
  await act(() => view.result.current.load(true));
  await act(async () => { finishOld({ sourceKey: "previous-key" }); await resume; });
  expect(view.result.current.sourceKey).toBe(sourceKey);
  expect(view.result.current.data).toBe(response);
});

it("retries null and a guarded quota failure with a newly resolved identity", async () => {
  vi.useFakeTimers();
  let attempt = 0;
  rpc.call.mockImplementation(async method => {
    if (method === "resolveSource") return { sourceKey: ++attempt === 1 ? null : `${sourceKey}-${attempt}` };
    return attempt === 2 ? { account: null, error: "unavailable" } : response;
  });
  const view = renderHook(() => useQuota(codex, 0));
  await advance(250);
  expect(view.result.current.loading).toBe(true);
  await advance(250);
  expect(view.result.current.data).toBe(response);
  expect(view.result.current.sourceKey).toBe(`${sourceKey}-3`);
  expect(reads()).toHaveLength(2);
  expect(resolutions()).toHaveLength(3);
});

it("bounds startup retries at zero polling and retries failed startup on remount", async () => {
  vi.useFakeTimers();
  rpc.call.mockImplementation(async method => method === "resolveSource" ? { sourceKey } : { account: null, error: "unavailable" });
  const first = renderHook(() => useQuota(codex, 0));
  await advance(1250);
  expect(reads()).toHaveLength(3);
  expect(first.result.current.loading).toBe(false);
  first.unmount();
  expect(vi.getTimerCount()).toBe(0);
  response = quota(82);
  rpc.call.mockImplementation(async method => method === "resolveSource" ? { sourceKey } : response);
  const next = renderHook(() => useQuota(codex, 0));
  await settle();
  expect(next.result.current.data).toBe(response);
  expect(reads()).toHaveLength(4);
});

it("cancels a recovery wait and further RPCs when the switched source unmounts", async () => {
  vi.useFakeTimers();
  const view = renderHook(() => useQuota(codex, 0));
  await settle();
  sourceKey += "-switched";
  rpc.call.mockImplementation(async method => method === "resolveSource" ? { sourceKey } : { account: null, error: "unavailable" });
  act(() => { void view.result.current.load(true); });
  await settle();
  view.unmount();
  await settle();
  const calls = rpc.call.mock.calls.length;
  expect(vi.getTimerCount()).toBe(0);
  await advance(5000);
  expect(rpc.call).toHaveBeenCalledTimes(calls);
});

it("polls unresolved active scopes by their interval, without polling when disabled or hidden", async () => {
  vi.useFakeTimers();
  let ready = false;
  rpc.call.mockImplementation(async method => method === "resolveSource" ? { sourceKey: ready ? sourceKey : null } : response);
  const first = renderHook(() => useQuota(codex, 2));
  const second = renderHook(() => useQuota({ ...codex }, 2), { wrapper: rpcWrapper() });
  await advance(1250);
  expect(first.result.current.loading).toBe(false);
  const before = resolutions().length;
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await advance(2000);
  expect(resolutions()).toHaveLength(before);
  hidden.mockReturnValue(false); ready = true;
  await advance(2000);
  expect(first.result.current.data).toBe(response);
  expect(second.result.current.data).toBe(response);
  expect(reads()).toHaveLength(1);
  first.unmount(); second.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("shares one provider discovery in flight across three visible surfaces", async () => {
  const providers = [{ id: "unknown", label: "Unknown", capabilities: { resets: false } }];
  let finish!: (value: { providers: typeof providers }) => void;
  rpc.call.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = renderHook(() => [useQuotaProviders("main"), useQuotaProviders("side"), useQuotaProviders("rail")]);
  expect(rpc.call).toHaveBeenCalledExactlyOnceWith("listProviders", {});
  await act(async () => { finish({ providers }); });
  expect(view.result.current).toEqual([providers, providers, providers]);
});

it("does not cache discovery failure and retries on focus without a timer", async () => {
  const providers = [{ id: "unknown", label: "Unknown", capabilities: { resets: false } }];
  rpc.call.mockRejectedValueOnce(new Error("temporary"));
  rpc.call.mockResolvedValueOnce({ providers });
  const view = renderHook(() => useQuotaProviders("selected"));
  await act(async () => {});
  expect(view.result.current).toEqual([]);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(rpc.call).toHaveBeenCalledTimes(2);
  expect(view.result.current).toEqual(providers);
});
