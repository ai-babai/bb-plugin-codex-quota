// @vitest-environment jsdom

import { useMemo } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getQuotaFormat } from "../lib/format";
import { QuotaPopover } from "../lib/quota-popover";
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
const expiryPanel = { name: format.text.resets };
const resetButton = (count: number) => ({ name: `${format.text.manualResets}: ${count}` });

function quotaSnapshot(observedAt: number, plan = "Pro"): Quota {
  return {
    account: {
      plan,
      observedAt,
      windows: [{ id: "weekly", kind: "weekly", label: "Weekly", remaining: 80, resetsAt: null }],
    },
    error: null,
  };
}

function QuotaCard({ quota, thread = threadId, fresh = true, open = true }: {
  quota: Quota; thread?: string; fresh?: boolean; open?: boolean;
}) {
  const location = useMemo(() => ({ threadId: thread }), [thread]);
  const count = useAvailableResetCount(location, quota, fresh);
  return open ? <ResetCount location={location} quota={quota} format={format} count={count} /> : null;
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
  vi.useRealTimers();
});

it.each([
  { name: "a new count", response: { count: 1, expiries: [newExpiry] } },
  { name: "zero", response: { count: 0 } },
  { name: "unavailable", response: { count: null } },
])("keeps the previous badge and open expiries while refreshing to $name", async ({ response }) => {
  serveSummary(Promise.resolve({ count: 2, expiries: [oldExpiry, null] }));
  const observedAt = Date.now();
  const { rerender } = render(<QuotaCard quota={quotaSnapshot(observedAt)} />);
  const badge = await screen.findByRole("button", resetButton(2));
  act(() => badge.focus());
  const expiries = await screen.findByRole("dialog", expiryPanel);
  const previousDate = format.formatExpiry(oldExpiry).date;
  expect(expiries.textContent).toContain(previousDate);

  const next = deferSummary();
  rpc.call.mockClear();
  serveSummary(next.promise);
  await act(async () => rerender(<QuotaCard quota={quotaSnapshot(observedAt + 1_000)} />));

  expect(rpc.call).toHaveBeenCalledWith("availableResets", { threadId, includeExpiries: false });
  expect(screen.queryByText("2")).not.toBeNull();
  expect(screen.getByRole("dialog", expiryPanel)).toBe(expiries);
  expect(expiries.textContent).toContain(previousDate);

  await act(async () => next.resolve(response));

  expect(screen.queryByText("2")).toBeNull();
  if (response.count === null) {
    expect(screen.queryByText(`${format.text.manualResets}:`)).toBeNull();
  } else {
    expect(screen.queryByText(String(response.count))).not.toBeNull();
  }
  if (response.count === 1) {
    const newExpiries = screen.getByRole("dialog", expiryPanel);
    expect(newExpiries.textContent).toContain(format.formatExpiry(newExpiry).date);
    expect(newExpiries.textContent).not.toContain(previousDate);
  } else {
    expect(screen.queryByRole("dialog", expiryPanel)).toBeNull();
    expect(screen.queryByRole("button", resetButton(0))).toBeNull();
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

it.each([
  { change: "the plan", nextThread: threadId, nextPlan: "Plus" },
  { change: "the thread", nextThread: "thread-b", nextPlan: "Pro" },
])("does not carry a known count across a change of $change", async ({ nextThread, nextPlan }) => {
  serveSummary(Promise.resolve({ count: 2 }));
  const observedAt = Date.now();
  const { rerender } = render(<QuotaCard quota={quotaSnapshot(observedAt)} />);
  await screen.findByText("2");

  const next = deferSummary();
  rpc.call.mockClear();
  serveSummary(next.promise);
  rerender(<QuotaCard quota={quotaSnapshot(observedAt + 1_000, nextPlan)} thread={nextThread} />);
  expect(rpc.call).toHaveBeenCalledExactlyOnceWith("availableResets", { threadId: nextThread, includeExpiries: false });
  expect(screen.queryByText("2")).toBeNull();
  expect(screen.queryByText(/^[—–-]$/)).not.toBeNull();

  await act(async () => next.resolve({ count: 1 }));
  expect(screen.queryByText("1")).not.toBeNull();
});

it("hides a known count once the quota becomes stale", async () => {
  serveSummary(Promise.resolve({ count: 2 }));
  const observedAt = Date.now();
  const { rerender } = render(<QuotaCard quota={quotaSnapshot(observedAt)} />);
  await screen.findByText("2");

  rpc.call.mockClear();
  rerender(<QuotaCard quota={quotaSnapshot(observedAt)} fresh={false} />);
  expect(rpc.call).not.toHaveBeenCalled();
  expect(screen.queryByText(`${format.text.manualResets}:`)).toBeNull();
});

it("groups expiry dates by minute and distinguishes unlimited from missing expiry data", async () => {
  serveSummary(Promise.resolve({ count: 7, expiries: [null, newExpiry, oldExpiry + 20, null, oldExpiry] }));
  render(<QuotaCard quota={quotaSnapshot(Date.now())} />);
  const badge = await screen.findByRole("button", resetButton(7));
  expect(rpc.call).toHaveBeenCalledExactlyOnceWith("availableResets", { threadId, includeExpiries: false });

  act(() => badge.focus());
  const panel = await screen.findByRole("dialog", expiryPanel);
  const rows = within(panel).getAllByRole("listitem").map(row => row.textContent);
  expect(rows).toEqual([
    expect.stringContaining(`${format.formatExpiry(oldExpiry).date} × 2`),
    expect.stringContaining(format.formatExpiry(newExpiry).date),
    `${format.text.noExpiry} × 2`,
    `${format.text.unknownExpiry} × 2`,
  ]);
});

function advance(milliseconds: number) {
  return act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

function renderQuotaPopover() {
  render(<>
    <button type="button">Composer</button>
    <QuotaPopover label="Quota ring" title="Quota card" trigger="65%" onRefresh={vi.fn()}>
      <h3>Codex · Pro</h3>
      <QuotaCard quota={quotaSnapshot(Date.now())} />
    </QuotaPopover>
  </>);
  return screen.getByRole("button", { name: "Quota ring" });
}

async function tap(target: HTMLElement, focusAfterTouch = target) {
  const pointer = { pointerType: "touch", pointerId: 1, isPrimary: true, button: 0 };
  fireEvent.pointerOver(target, pointer);
  fireEvent.pointerDown(target, pointer);
  fireEvent.touchStart(target);
  fireEvent.pointerUp(target, pointer);
  fireEvent.pointerOut(target, pointer);
  fireEvent.touchEnd(target);
  if (focusAfterTouch instanceof HTMLButtonElement) act(() => focusAfterTouch.focus());
  fireEvent.click(target, { detail: 1 });
  await advance(1);
}

it("toggles on touch, keeps the quota card open on an inside dismissal, and only reads", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  serveSummary(Promise.resolve({ count: 2, expiries: [oldExpiry, null] }));
  await tap(renderQuotaPopover());
  const badge = screen.getByRole("button", resetButton(2));
  expect(badge.getAttribute("aria-expanded")).toBe("false");

  await tap(badge);
  const panel = screen.getByRole("dialog", expiryPanel);
  const noExpiry = within(panel).getByText(format.text.noExpiry);
  await tap(noExpiry);
  expect(screen.getByRole("dialog", expiryPanel)).toBe(panel);
  await tap(badge);
  expect(screen.queryByRole("dialog", expiryPanel)).toBeNull();

  await tap(badge);
  await tap(screen.getByRole("heading", { name: "Codex · Pro" }), screen.getByRole("button", { name: "Composer" }));
  expect(screen.queryByRole("dialog", expiryPanel)).toBeNull();
  expect(screen.getByRole("button", resetButton(2))).toBe(badge);

  await tap(badge);
  await tap(screen.getByRole("button", { name: "Composer" }));
  expect(screen.queryByRole("dialog", expiryPanel)).toBeNull();
  expect(screen.queryByRole("dialog", { name: "Quota card" })).toBeNull();
  expect(rpc.call.mock.calls).toEqual([
    ["availableResets", { threadId, includeExpiries: false }],
    ["availableResets", { threadId, includeExpiries: true }],
  ]);
});

it("does not reopen after a pending touch read is dismissed", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const next = deferSummary();
  rpc.call.mockImplementation((_method, { includeExpiries }) =>
    includeExpiries ? next.promise : Promise.resolve({ count: 2 }));
  await tap(renderQuotaPopover());
  const badge = screen.getByRole("button", resetButton(2));
  await tap(badge);
  expect(within(screen.getByRole("dialog", expiryPanel)).getByRole("status").textContent).toBe("…");

  await tap(screen.getByRole("heading", { name: "Codex · Pro" }));
  expect(screen.queryByRole("dialog", expiryPanel)).toBeNull();
  await act(async () => next.resolve({ count: 2, expiries: [oldExpiry, null] }));
  expect(screen.queryByRole("dialog", expiryPanel)).toBeNull();
  expect(badge.getAttribute("aria-expanded")).toBe("false");
  await tap(badge);
  expect(within(screen.getByRole("dialog", expiryPanel)).getByText(format.text.noExpiry)).toBeTruthy();
  expect(rpc.call).toHaveBeenCalledTimes(2);
});

it("uses a native toggle button for keyboard activation and dismisses only details on Escape", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  serveSummary(Promise.resolve({ count: 2, expiries: [oldExpiry, null] }));
  fireEvent.click(renderQuotaPopover(), { detail: 0 });
  await advance(1);
  const badge = screen.getByRole("button", resetButton(2));
  expect(badge).toBeInstanceOf(HTMLButtonElement);
  expect(badge.getAttribute("type")).toBe("button");
  act(() => badge.focus());
  await advance(1);
  expect(badge.getAttribute("aria-expanded")).toBe("true");
  expect(badge.getAttribute("aria-controls")).toBe(screen.getByRole("dialog", expiryPanel).id);

  // jsdom does not dispatch the browser's native button click for Enter or Space.
  fireEvent.keyDown(badge, { key: "Enter" });
  fireEvent.click(badge, { detail: 0 });
  fireEvent.keyUp(badge, { key: "Enter" });
  expect(badge.getAttribute("aria-expanded")).toBe("false");
  fireEvent.keyDown(badge, { key: " " });
  fireEvent.keyUp(badge, { key: " " });
  fireEvent.click(badge, { detail: 0 });
  expect(badge.getAttribute("aria-expanded")).toBe("true");
  fireEvent.keyDown(badge, { key: "Escape" });
  await advance(1);
  expect(screen.queryByRole("dialog", expiryPanel)).toBeNull();
  expect(screen.getByRole("dialog", { name: "Quota card" })).toBeTruthy();
  expect(document.activeElement).toBe(badge);
});

it("waits for expiry data on hover and gives the pointer time to cross the gap both ways", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const next = deferSummary();
  rpc.call.mockImplementation((_method, { includeExpiries }) =>
    includeExpiries ? next.promise : Promise.resolve({ count: 2 }));
  await tap(renderQuotaPopover());
  const badge = screen.getByRole("button", resetButton(2));
  const header = screen.getByRole("heading", { name: "Codex · Pro" });
  const mouse = { pointerType: "mouse" };
  fireEvent.pointerOut(header, { ...mouse, relatedTarget: badge });
  fireEvent.pointerOver(badge, { ...mouse, relatedTarget: header });
  await advance(150);
  expect(rpc.call).toHaveBeenCalledWith("availableResets", { threadId, includeExpiries: true });
  expect(screen.queryByRole("dialog", expiryPanel)).toBeNull();

  await act(async () => next.resolve({ count: 2, expiries: [oldExpiry, null] }));
  const panel = screen.getByRole("dialog", expiryPanel);
  fireEvent.pointerOut(badge, { ...mouse, relatedTarget: header });
  await advance(100);
  fireEvent.pointerOut(header, { ...mouse, relatedTarget: panel });
  fireEvent.pointerOver(panel, { ...mouse, relatedTarget: header });
  await advance(200);
  expect(screen.getByRole("dialog", expiryPanel)).toBe(panel);
  fireEvent.pointerOut(panel, { ...mouse, relatedTarget: header });
  await advance(100);
  fireEvent.pointerOut(header, { ...mouse, relatedTarget: badge });
  fireEvent.pointerOver(badge, { ...mouse, relatedTarget: header });
  await advance(200);
  expect(screen.getByRole("dialog", expiryPanel)).toBe(panel);

  fireEvent.pointerOut(badge, { ...mouse, relatedTarget: header });
  await advance(200);
  expect(screen.queryByRole("dialog", expiryPanel)).toBeNull();
});
