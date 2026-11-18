// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getQuotaFormat } from "../lib/format";
import { ResetCount, useAvailableResetCount } from "../lib/reset-count";
import type { Quota } from "../server";

type ResetSummary = { count: number | null; expiries?: (number | null)[] };

const rpc = vi.hoisted(() => ({
  call: vi.fn<(method: "availableResets", input: { threadId: string; includeExpiries?: boolean }) => Promise<ResetSummary>>(),
}));

vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc, experimental_Icon: () => null }));

const threadId = "thread-a";
const format = getQuotaFormat("en");
const oldExpiry = Date.UTC(2030, 5, 10, 12) / 1000;
const newExpiry = Date.UTC(2030, 6, 20, 12) / 1000;

function quotaSnapshot(observedAt: number): Quota {
  return {
    account: {
      plan: "Pro",
      observedAt,
      windows: [{ id: "weekly", kind: "weekly", label: "Weekly", remaining: 80, resetsAt: null }],
    },
    error: null,
  };
}

function QuotaCard({ quota, open = true }: { quota: Quota; open?: boolean }) {
  const count = useAvailableResetCount(threadId, quota, true);
  return open ? <ResetCount threadId={threadId} quota={quota} format={format} count={count} /> : null;
}

function serveSummary(response: Promise<ResetSummary>) {
  rpc.call.mockImplementation(async (_method, { includeExpiries }) => {
    const summary = await response;
    return includeExpiries ? summary : { count: summary.count };
  });
}

function deferSummary() {
  let resolve!: (summary: ResetSummary) => void;
  const promise = new Promise<ResetSummary>(finish => { resolve = finish; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  rpc.call.mockReset();
});

it.each([
  { name: "a new count", response: { count: 1, expiries: [newExpiry] } },
  { name: "zero", response: { count: 0 } },
  { name: "unavailable", response: { count: null } },
])("keeps the previous badge and open expiries while refreshing to $name", async ({ response }) => {
  serveSummary(Promise.resolve({ count: 2, expiries: [oldExpiry, null] }));
  const observedAt = Date.now();
  const { rerender } = render(<QuotaCard quota={quotaSnapshot(observedAt)} />);
  const badge = await screen.findByText("2");
  act(() => badge.focus());
  const expiries = await screen.findByRole("tooltip");
  const previousDate = format.formatExpiry(oldExpiry).date;
  expect(expiries.textContent).toContain(previousDate);

  const next = deferSummary();
  rpc.call.mockClear();
  serveSummary(next.promise);
  await act(async () => rerender(<QuotaCard quota={quotaSnapshot(observedAt + 1_000)} />));

  expect(rpc.call).toHaveBeenCalledWith("availableResets", { threadId, includeExpiries: false });
  expect(screen.queryByText("2")).not.toBeNull();
  expect(screen.getByRole("tooltip").textContent).toContain(previousDate);

  await act(async () => next.resolve(response));

  expect(screen.queryByText("2")).toBeNull();
  if (response.count === null) {
    expect(screen.queryByText(`${format.text.manualResets}:`)).toBeNull();
  } else {
    expect(screen.queryByText(String(response.count))).not.toBeNull();
  }
  if (response.count === 1) {
    const newExpiries = screen.getByRole("tooltip");
    expect(newExpiries.textContent).toContain(format.formatExpiry(newExpiry).date);
    expect(newExpiries.textContent).not.toContain(previousDate);
  } else {
    expect(screen.queryByRole("tooltip")).toBeNull();
  }
});

it("starts the read before the first card open and shows a placeholder while waiting", async () => {
  const next = deferSummary();
  serveSummary(next.promise);
  const quota = quotaSnapshot(Date.now());
  const { rerender } = render(<QuotaCard quota={quota} open={false} />);

  expect(rpc.call).toHaveBeenCalledWith("availableResets", { threadId, includeExpiries: false });
  rerender(<QuotaCard quota={quota} />);
  expect(screen.queryByText(/^[—–-]$/)).not.toBeNull();

  await act(async () => next.resolve({ count: 2 }));

  expect(screen.queryByText("2")).not.toBeNull();
  expect(screen.queryByText(/^[—–-]$/)).toBeNull();
});
