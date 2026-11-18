// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuotaPopover } from "../lib/quota-popover";

const label = "Codex quota";
const refreshButton = { name: "Refresh" };

function renderQuota() {
  const refresh = vi.fn();
  render(
    <>
      <textarea aria-label="Message" />
      <QuotaPopover label={label} title="Codex usage" trigger={<span>75%</span>}>
        <button type="button" onClick={refresh}>Refresh</button>
      </QuotaPopover>
    </>,
  );

  return {
    composer: screen.getByRole("textbox", { name: "Message" }),
    trigger: screen.getByRole("button", { name: label }),
    refresh,
  };
}

function moveMouse(from: HTMLElement, to: HTMLElement) {
  fireEvent.pointerOut(from, { pointerType: "mouse", relatedTarget: to });
  fireEvent.pointerOver(to, { pointerType: "mouse", relatedTarget: from });
  fireEvent.mouseOut(from, { relatedTarget: to });
  fireEvent.mouseOver(to, { relatedTarget: from });
}

async function settleTimers() {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
}

describe("QuotaPopover interactions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("opens immediately on hover, keeps composer focus, and closes on leave", async () => {
    const { composer, trigger } = renderQuota();
    act(() => composer.focus());
    expect(screen.queryByRole("button", refreshButton)).toBeNull();

    moveMouse(composer, trigger);
    expect(screen.getByRole("button", refreshButton)).toBeTruthy();
    expect(document.activeElement).toBe(composer);
    await settleTimers();
    expect(document.activeElement).toBe(composer);

    moveMouse(trigger, composer);
    await settleTimers();
    expect(screen.queryByRole("button", refreshButton)).toBeNull();
    expect(document.activeElement).toBe(composer);
  });

  it("keeps Refresh usable when the pointer crosses into the panel and closes on exit", async () => {
    const { composer, trigger, refresh } = renderQuota();
    moveMouse(composer, trigger);

    moveMouse(trigger, composer);
    const refreshControl = screen.getByRole("button", refreshButton);
    moveMouse(composer, refreshControl);
    await settleTimers();
    fireEvent.pointerDown(screen.getByRole("button", refreshButton), { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(screen.getByRole("button", refreshButton), { pointerType: "mouse", button: 0 });
    fireEvent.click(screen.getByRole("button", refreshButton));
    expect(refresh).toHaveBeenCalledTimes(1);

    moveMouse(refreshControl, composer);
    await settleTimers();
    expect(screen.queryByRole("button", refreshButton)).toBeNull();
  });

  it("dismisses the hover preview with Escape while the composer has focus", async () => {
    const { composer, trigger } = renderQuota();
    act(() => composer.focus());
    moveMouse(composer, trigger);
    expect(screen.getByRole("button", refreshButton)).toBeTruthy();
    await settleTimers();

    fireEvent.keyDown(composer, { key: "Escape" });
    await settleTimers();
    expect(screen.queryByRole("button", refreshButton)).toBeNull();
    expect(document.activeElement).toBe(composer);
  });

  it("pins an open preview on click and closes it on the next click", async () => {
    const { composer, trigger } = renderQuota();
    moveMouse(composer, trigger);
    expect(screen.getByRole("button", refreshButton)).toBeTruthy();

    fireEvent.click(trigger, { detail: 1 });
    moveMouse(trigger, composer);
    await settleTimers();
    expect(screen.getByRole("button", refreshButton)).toBeTruthy();

    moveMouse(composer, trigger);
    fireEvent.click(trigger, { detail: 1 });
    await settleTimers();
    expect(screen.queryByRole("button", refreshButton)).toBeNull();
  });

  it("opens and pins on tap, then closes on a second tap", async () => {
    const { composer, trigger } = renderQuota();

    function tapTrigger() {
      const touch = { pointerType: "touch", pointerId: 1, isPrimary: true };
      fireEvent.pointerOver(trigger, touch);
      fireEvent.pointerDown(trigger, touch);
      fireEvent.pointerUp(trigger, touch);
      fireEvent.pointerOut(trigger, touch);
      fireEvent.click(trigger, { detail: 1 });
    }

    tapTrigger();
    expect(screen.getByRole("button", refreshButton)).toBeTruthy();
    moveMouse(composer, trigger);
    moveMouse(trigger, composer);
    await settleTimers();
    expect(screen.getByRole("button", refreshButton)).toBeTruthy();

    tapTrigger();
    await settleTimers();
    expect(screen.queryByRole("button", refreshButton)).toBeNull();
  });

  it.each([
    { name: "Enter", key: "Enter", code: "Enter", activateOn: "keydown" },
    { name: "Space", key: " ", code: "Space", activateOn: "keyup" },
  ])("pins with $name and restores trigger focus after Escape", async ({ key, code, activateOn }) => {
    const { composer, trigger } = renderQuota();
    expect(trigger).toBeInstanceOf(HTMLButtonElement);
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);

    // jsdom does not generate the native button click from keyboard events.
    const keyDownAllowed = fireEvent.keyDown(trigger, { key, code });
    if (activateOn === "keydown" && keyDownAllowed) fireEvent.click(trigger, { detail: 0 });
    const keyUpAllowed = fireEvent.keyUp(trigger, { key, code });
    if (activateOn === "keyup" && keyDownAllowed && keyUpAllowed) {
      fireEvent.click(trigger, { detail: 0 });
    }
    expect(screen.getByRole("button", refreshButton)).toBeTruthy();

    moveMouse(composer, trigger);
    moveMouse(trigger, composer);
    await settleTimers();
    const refresh = screen.getByRole("button", refreshButton);
    act(() => refresh.focus());
    expect(document.activeElement).toBe(refresh);

    fireEvent.keyDown(refresh, { key: "Escape" });
    await settleTimers();
    expect(screen.queryByRole("button", refreshButton)).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
