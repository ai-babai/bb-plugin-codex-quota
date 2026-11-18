// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuotaPopover } from "../lib/quota-popover";

const label = "Codex quota";
const detailsButton = { name: "Details" };

function renderQuota() {
  const details = vi.fn();
  const activate = vi.fn();
  render(
    <>
      <textarea aria-label="Message" />
      <QuotaPopover onRefresh={activate} label={label} title="Codex usage" trigger={<span>75%</span>}>
        <button type="button" onClick={details}>Details</button>
      </QuotaPopover>
    </>,
  );

  return {
    composer: screen.getByRole("textbox", { name: "Message" }),
    trigger: screen.getByRole("button", { name: label }),
    details, activate,
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
    expect(screen.queryByRole("button", detailsButton)).toBeNull();

    moveMouse(composer, trigger);
    expect(screen.getByRole("button", detailsButton)).toBeTruthy();
    expect(document.activeElement).toBe(composer);
    await settleTimers();
    expect(document.activeElement).toBe(composer);

    moveMouse(trigger, composer);
    await settleTimers();
    expect(screen.queryByRole("button", detailsButton)).toBeNull();
    expect(document.activeElement).toBe(composer);
  });

  it("keeps Details usable when the pointer crosses into the panel and closes on exit", async () => {
    const { composer, trigger, details } = renderQuota();
    moveMouse(composer, trigger);

    moveMouse(trigger, composer);
    const detailsControl = screen.getByRole("button", detailsButton);
    moveMouse(composer, detailsControl);
    await settleTimers();
    fireEvent.pointerDown(screen.getByRole("button", detailsButton), { pointerType: "mouse", button: 0 });
    fireEvent.pointerUp(screen.getByRole("button", detailsButton), { pointerType: "mouse", button: 0 });
    fireEvent.click(screen.getByRole("button", detailsButton));
    expect(details).toHaveBeenCalledTimes(1);

    moveMouse(detailsControl, composer);
    await settleTimers();
    expect(screen.queryByRole("button", detailsButton)).toBeNull();
  });

  it("dismisses the hover preview with Escape while the composer has focus", async () => {
    const { composer, trigger } = renderQuota();
    act(() => composer.focus());
    moveMouse(composer, trigger);
    expect(screen.getByRole("button", detailsButton)).toBeTruthy();
    await settleTimers();

    fireEvent.keyDown(composer, { key: "Escape" });
    await settleTimers();
    expect(screen.queryByRole("button", detailsButton)).toBeNull();
    expect(document.activeElement).toBe(composer);
  });

  it("closes the hover preview on click and reopens it on the next click", async () => {
    const { composer, trigger } = renderQuota();
    moveMouse(composer, trigger);
    expect(screen.getByRole("button", detailsButton)).toBeTruthy();

    fireEvent.click(trigger, { detail: 1 });
    await settleTimers();
    expect(screen.queryByRole("button", detailsButton)).toBeNull();

    fireEvent.click(trigger, { detail: 1 });
    expect(screen.getByRole("button", detailsButton)).toBeTruthy();

    moveMouse(trigger, composer);
    await settleTimers();
    expect(screen.getByRole("button", detailsButton)).toBeTruthy();
  });

  it("opens on tap and closes on a second tap", async () => {
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
    expect(screen.getByRole("button", detailsButton)).toBeTruthy();
    moveMouse(composer, trigger);
    moveMouse(trigger, composer);
    await settleTimers();
    expect(screen.getByRole("button", detailsButton)).toBeTruthy();

    tapTrigger();
    await settleTimers();
    expect(screen.queryByRole("button", detailsButton)).toBeNull();
  });

  it.each([
    { name: "Enter", key: "Enter", code: "Enter", activateOn: "keydown" },
    { name: "Space", key: " ", code: "Space", activateOn: "keyup" },
  ])("opens and closes with $name and restores trigger focus after Escape", async ({ key, code, activateOn }) => {
    const { composer, trigger } = renderQuota();
    expect(trigger).toBeInstanceOf(HTMLButtonElement);
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);

    function activateTrigger() {
      // jsdom does not generate the native button click from keyboard events.
      const keyDownAllowed = fireEvent.keyDown(trigger, { key, code });
      if (activateOn === "keydown" && keyDownAllowed) fireEvent.click(trigger, { detail: 0 });
      const keyUpAllowed = fireEvent.keyUp(trigger, { key, code });
      if (activateOn === "keyup" && keyDownAllowed && keyUpAllowed) {
        fireEvent.click(trigger, { detail: 0 });
      }
    }

    activateTrigger();
    expect(screen.getByRole("button", detailsButton)).toBeTruthy();
    await settleTimers();

    act(() => trigger.focus());
    activateTrigger();
    await settleTimers();
    expect(screen.queryByRole("button", detailsButton)).toBeNull();
    expect(document.activeElement).toBe(trigger);

    activateTrigger();
    expect(screen.getByRole("button", detailsButton)).toBeTruthy();

    moveMouse(composer, trigger);
    moveMouse(trigger, composer);
    await settleTimers();
    const details = screen.getByRole("button", detailsButton);
    act(() => details.focus());
    expect(document.activeElement).toBe(details);

    fireEvent.keyDown(details, { key: "Escape" });
    await settleTimers();
    expect(screen.queryByRole("button", detailsButton)).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

it("requests fresh quota on hover and activation without extra reads on movement or touch entry", async () => {
  const { composer, trigger, activate } = renderQuota();
  moveMouse(composer, trigger);
  fireEvent.pointerMove(trigger, { pointerType: "mouse" });
  expect(activate).toHaveBeenCalledTimes(1);
  fireEvent.click(trigger, { detail: 1 });
  expect(activate).toHaveBeenCalledTimes(2);
  fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
  fireEvent.pointerEnter(trigger, { pointerType: "touch" });
  fireEvent.pointerDown(trigger, { pointerType: "touch" });
  fireEvent.pointerUp(trigger, { pointerType: "touch" });
  fireEvent.click(trigger, { detail: 1 });
  expect(activate).toHaveBeenCalledTimes(3);
});
