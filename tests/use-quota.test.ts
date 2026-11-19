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

vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => useContext(rpcContext) ?? client.current,
  useRealtimeConnectionState: () => "connected",
}));

function rpcWrapper() {
  const value = { call: rpc.call };
  return ({ children }: PropsWithChildren) => createElement(rpcContext.Provider, { value }, children);
}

beforeEach(() => { client.current = { call: rpc.call }; });

afterEach(() => {
  cleanup();
  rpc.call.mockReset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("keeps the manually refreshed quota when an older read finishes last", async () => {
  let finishPoll!: (value: Quota) => void;
  rpc.call.mockReturnValueOnce(new Promise<Quota>(resolve => { finishPoll = resolve; }));
  const fresh: Quota = { account: { plan: "Plus", observedAt: 500, windows: [] }, error: null };
  rpc.call.mockResolvedValueOnce(fresh);
  const { result } = renderHook(() => useQuota(location));
  await act(() => result.current.load(true));
  expect(rpc.call).toHaveBeenNthCalledWith(2, "quota", { threadId: "thread-a", refresh: true });
  await act(async () => { finishPoll({ account: null, error: "unavailable" }); });
  expect(result.current.data).toEqual(fresh);
});

it("reschedules polling when the interval changes and stops polling at zero", async () => {
  vi.useFakeTimers();
  const quota: Quota = { account: { plan: "Plus", observedAt: 500, windows: [] }, error: null };
  rpc.call.mockResolvedValue(quota);
  const { rerender } = renderHook(
    ({ intervalSeconds }: { intervalSeconds?: number }) => useQuota(location, intervalSeconds),
    { initialProps: {} },
  );
  const advance = (milliseconds: number) => act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });

  await advance(119_999);
  expect(rpc.call).toHaveBeenCalledExactlyOnceWith("quota", { threadId: "thread-a", refresh: false });
  await advance(1);
  expect(rpc.call).toHaveBeenCalledTimes(2);
  expect(rpc.call).toHaveBeenLastCalledWith("quota", { threadId: "thread-a", refresh: true });

  // Change the interval five seconds before the old poll would be due.
  await advance(115_000);
  await act(async () => rerender({ intervalSeconds: 60 }));
  rpc.call.mockClear();
  await advance(59_999);
  expect(rpc.call).not.toHaveBeenCalled();
  await advance(1);
  expect(rpc.call).toHaveBeenCalledExactlyOnceWith("quota", { threadId: "thread-a", refresh: true });

  await act(async () => rerender({ intervalSeconds: 0 }));
  rpc.call.mockClear();
  await advance(240_000);
  expect(rpc.call).not.toHaveBeenCalled();

  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(rpc.call).toHaveBeenCalledExactlyOnceWith("quota", { threadId: "thread-a", refresh: false });
});

it("skips scheduled reads while hidden and resumes with a cached read", async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  rpc.call.mockResolvedValue({ account: null, error: "unavailable" } satisfies Quota);
  renderHook(() => useQuota(location, 2));

  await act(() => vi.advanceTimersByTimeAsync(4_000));
  expect(rpc.call).toHaveBeenCalledExactlyOnceWith("quota", { threadId: "thread-a", refresh: false });

  hidden.mockReturnValue(false);
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(rpc.call).toHaveBeenNthCalledWith(2, "quota", { threadId: "thread-a", refresh: false });

  await act(() => vi.advanceTimersByTimeAsync(2_000));
  expect(rpc.call).toHaveBeenCalledTimes(3);
  expect(rpc.call).toHaveBeenLastCalledWith("quota", { threadId: "thread-a", refresh: true });
});

it("reads cached quota on startup for a third-party provider", async () => {
  const thirdParty = { ...location, providerId: "third-party" };
  const quota: Quota = { account: { plan: "Pro", observedAt: 500, windows: [] }, error: null };
  rpc.call.mockResolvedValue(quota);
  const { result } = renderHook(() => useQuota(thirdParty, 0));

  await act(async () => {});
  expect(rpc.call).toHaveBeenCalledExactlyOnceWith("quota", { ...thirdParty, refresh: false });
  expect(result.current.data).toEqual(quota);
});

it("shares an in-flight Codex startup refresh and uses a cached read for a later ring", async () => {
  let finishRefresh!: (value: Quota) => void;
  rpc.call.mockReturnValueOnce(new Promise<Quota>(resolve => { finishRefresh = resolve; }));
  const fresh: Quota = { account: { plan: "Pro", observedAt: 500, windows: [] }, error: null };
  const cached: Quota = { account: { plan: "Pro", observedAt: 400, windows: [] }, error: null };
  rpc.call.mockResolvedValueOnce(cached);
  const sidebarLocation = { ...codex };
  const chat = renderHook(() => useQuota(codex, 0), { wrapper: rpcWrapper() });
  const sidebar = renderHook(() => useQuota(sidebarLocation, 0, true), { wrapper: rpcWrapper() });

  expect(rpc.call).toHaveBeenCalledExactlyOnceWith("quota", { ...codex, refresh: true });
  await act(async () => { finishRefresh(fresh); });
  expect(chat.result.current.data).toEqual(fresh);
  expect(sidebar.result.current.data).toEqual(fresh);
  expect(rpc.call).toHaveBeenCalledTimes(1);

  sidebar.unmount();
  const reopenedSidebar = renderHook(() => useQuota(sidebarLocation, 0), { wrapper: rpcWrapper() });
  await act(async () => {});
  expect(rpc.call).toHaveBeenCalledTimes(2);
  expect(rpc.call).toHaveBeenLastCalledWith("quota", { ...codex, refresh: false });
  expect(reopenedSidebar.result.current.data).toEqual(cached);
});

it("reads cached Codex quota until the provider is confirmed", async () => {
  rpc.call.mockResolvedValue({ account: null, error: "unavailable" } satisfies Quota);
  const { rerender } = renderHook(({ confirmed }) => useQuota(codex, 0, confirmed), {
    initialProps: { confirmed: false },
  });

  await act(async () => {});
  expect(rpc.call).toHaveBeenCalledExactlyOnceWith("quota", { ...codex, refresh: false });

  await act(async () => rerender({ confirmed: true }));
  expect(rpc.call).toHaveBeenCalledTimes(2);
  expect(rpc.call).toHaveBeenLastCalledWith("quota", { ...codex, refresh: true });
});

it("starts a fresh read when the confirmed Codex scope changes", async () => {
  const next = { ...codex, threadId: "thread-b" };
  rpc.call.mockResolvedValue({ account: null, error: "unavailable" } satisfies Quota);
  const { rerender } = renderHook(({ scope }) => useQuota(scope, 0), { initialProps: { scope: codex } });

  await act(async () => rerender({ scope: next }));
  expect(rpc.call.mock.calls).toEqual([
    ["quota", { ...codex, refresh: true }],
    ["quota", { ...next, refresh: true }],
  ]);
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
