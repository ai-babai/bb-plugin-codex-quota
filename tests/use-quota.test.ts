// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useQuota } from "../lib/use-quota";
import type { Quota } from "../server";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc }));

afterEach(() => { cleanup(); rpc.call.mockReset(); });

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
