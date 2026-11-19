// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntervalHelp } from "../lib/interval-help";
import { QuotaPopover } from "../lib/quota-popover";

vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_Icon: () => null }));

const id = "refresh-help";
const label = "About auto-refresh";
const text = "0 disables auto-refresh";
const mouse = { pointerType: "mouse" };

function mount() {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(<QuotaPopover label="Quota ring" title="Quota settings" trigger="65%" onRefresh={() => {}}>
    <form aria-label="Settings" onSubmit={submit}>
      <div><label htmlFor="refresh">Refresh</label><IntervalHelp id={id} text={text} label={label} /></div>
      <input id="refresh" type="number" aria-describedby={id} />
      <button type="submit">Save</button>
    </form>
  </QuotaPopover>);
  fireEvent.click(screen.getByRole("button", { name: "Quota ring" }));
  return { submit, trigger: screen.getByRole("button", { name: label }) };
}

function advance(milliseconds: number) {
  return act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

function timers() { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); }

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("describes the input before opening, uses a native non-submit button and stays local to the form", () => {
  const { trigger, submit } = mount();
  const description = document.getElementById(screen.getByRole("spinbutton").getAttribute("aria-describedby")!);
  expect(description?.textContent).toBe(text);
  expect(trigger.getAttribute("aria-describedby")).toBe(id);
  expect(trigger.getAttribute("type")).toBe("button");
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.click(trigger);
  const bubble = screen.getByRole("tooltip", { name: label });
  expect(bubble.textContent).toBe(text);
  expect(screen.getByRole("form", { name: "Settings" }).contains(bubble)).toBe(true);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(trigger.getAttribute("aria-controls")).toBe(bubble.id);
  expect(submit).not.toHaveBeenCalled();
});

it("previews on hover, crosses the gap both ways and closes on leave without taking focus", async () => {
  timers();
  const { trigger } = mount();
  const input = screen.getByRole("spinbutton");
  act(() => input.focus());
  fireEvent.pointerOver(trigger, mouse);
  await advance(149);
  expect(screen.queryByRole("tooltip")).toBeNull();
  await advance(1);
  const bubble = screen.getByRole("tooltip");
  expect(document.activeElement).toBe(input);
  fireEvent.pointerLeave(trigger, mouse);
  await advance(100);
  fireEvent.pointerOver(bubble, mouse);
  await advance(200);
  expect(screen.getByRole("tooltip")).toBe(bubble);
  fireEvent.pointerLeave(bubble, mouse);
  await advance(100);
  fireEvent.pointerOver(trigger, mouse);
  await advance(200);
  expect(screen.getByRole("tooltip")).toBe(bubble);
  fireEvent.pointerLeave(trigger, mouse);
  await advance(181);
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(document.activeElement).toBe(input);
});

it("cancels a pending hover on early exit and unmount", async () => {
  timers();
  const { trigger } = mount();
  fireEvent.pointerOver(trigger, mouse);
  fireEvent.pointerLeave(trigger, mouse);
  await advance(200);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.pointerOver(trigger, mouse);
  cleanup();
  await advance(200);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("opens on keyboard focus; the first Escape dismisses only help and the second closes the form", async () => {
  timers();
  const { trigger } = mount();
  act(() => trigger.focus());
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.pointerLeave(trigger, mouse);
  await advance(200);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.keyDown(trigger, { key: "Escape" });
  await advance(1);
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(screen.getByRole("form", { name: "Settings" })).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: "Escape" });
  await advance(1);
  expect(screen.queryByRole("form", { name: "Settings" })).toBeNull();
});

it.each(["Enter", " "])("pins and toggles with native keyboard activation %j without submitting", async key => {
  timers();
  const { trigger, submit } = mount();
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key });
  fireEvent.keyUp(trigger, { key });
  // jsdom does not synthesize a native button click from Enter/Space.
  fireEvent.click(trigger, { detail: 0 });
  fireEvent.pointerLeave(trigger, mouse);
  await advance(200);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.click(trigger, { detail: 0 });
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

it("pins on the first tap despite touch focus, toggles on the next tap and closes on an outside tap", async () => {
  timers();
  const { trigger } = mount();
  const pointer = { pointerType: "touch", pointerId: 1, isPrimary: true, button: 0 };
  async function tap(target: HTMLElement) {
    fireEvent.pointerOver(target, pointer);
    fireEvent.pointerDown(target, pointer);
    fireEvent.touchStart(target);
    if (target instanceof HTMLButtonElement) act(() => target.focus());
    fireEvent.pointerUp(target, pointer);
    fireEvent.touchEnd(target);
    fireEvent.pointerOut(target, pointer);
    fireEvent.click(target, { detail: 1 });
    await advance(1);
  }
  fireEvent.pointerOver(trigger, pointer);
  await advance(200);
  expect(screen.queryByRole("tooltip")).toBeNull();
  await tap(trigger);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.pointerLeave(trigger, mouse);
  await advance(200);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  await tap(trigger);
  expect(screen.queryByRole("tooltip")).toBeNull();
  await tap(trigger);
  await tap(screen.getByRole("spinbutton"));
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(screen.getByRole("form", { name: "Settings" })).toBeTruthy();
});

it("dismisses on focus outside and keeps the permanent description localized", async () => {
  timers();
  render(<><IntervalHelp id="ru-help" label="Об автообновлении" text="0 отключает автообновление" /><button>Next</button></>);
  const trigger = screen.getByRole("button", { name: "Об автообновлении" });
  act(() => trigger.focus());
  expect(screen.getByRole("tooltip").textContent).toBe("0 отключает автообновление");
  act(() => screen.getByRole("button", { name: "Next" }).focus());
  await advance(1);
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(document.getElementById("ru-help")?.textContent).toBe("0 отключает автообновление");
});
