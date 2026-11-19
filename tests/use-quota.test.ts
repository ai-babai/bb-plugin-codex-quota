// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useQuota, useQuotaProviders } from "../lib/use-quota";
import type { Quota } from "../server";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
const client = vi.hoisted(() => ({ current: {} as { call: ReturnType<typeof vi.fn> } }));
const location = { threadId: "thread-a" };

vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => client.current, useRealtimeConnectionState: () => "connected" }));

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
