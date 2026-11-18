// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useQuota } from "../lib/use-quota";
import type { Quota } from "../server";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc }));

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
  const { result } = renderHook(() => useQuota("thread-a"));
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
    ({ intervalSeconds }: { intervalSeconds?: number }) => useQuota("thread-a", intervalSeconds),
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
  renderHook(() => useQuota("thread-a", 2));

  await act(() => vi.advanceTimersByTimeAsync(4_000));
  expect(rpc.call).toHaveBeenCalledExactlyOnceWith("quota", { threadId: "thread-a", refresh: false });

  hidden.mockReturnValue(false);
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(rpc.call).toHaveBeenNthCalledWith(2, "quota", { threadId: "thread-a", refresh: false });

  await act(() => vi.advanceTimersByTimeAsync(2_000));
  expect(rpc.call).toHaveBeenCalledTimes(3);
  expect(rpc.call).toHaveBeenLastCalledWith("quota", { threadId: "thread-a", refresh: true });
});
