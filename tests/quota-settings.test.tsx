// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, expect, it, vi } from "vitest";
import { QuotaPopover } from "../lib/quota-popover";
import { QuotaSettingsCard } from "../lib/quota-settings";

function Card() {
  return <>
    <textarea aria-label="Composer" />
    <QuotaPopover label="Quota ring" title="Codex quota" onRefresh={() => {}} trigger="65%">
      <QuotaSettingsCard>{settingsButton => <>
        <div className="flex items-center"><h3>Codex · Pro</h3>{settingsButton}</div>
        <p>Weekly: 65% left</p>
        <button type="button">Details</button>
      </>}</QuotaSettingsCard>
    </QuotaPopover>
  </>;
}

function mount(settings: RenderSlotOptions["settings"] = {}) {
  const persisted = { ...settings };
  const updateSettings = vi.fn(async ({ values }: { pluginId: string; values: Record<string, unknown> }) => {
    Object.assign(persisted, values);
    return { ok: true as const, schema: {}, values: { ...persisted } };
  });
  renderSlot({ component: Card }, {}, {
    pluginId: "codex-quota", settings,
    sdk: { plugins: { updateSettings } },
  });
  return { updateSettings, persisted, ring: screen.getByRole("button", { name: "Quota ring" }) };
}

function openSettings(ring: HTMLElement, name = "Settings") {
  fireEvent.click(ring);
  fireEvent.click(screen.getByRole("button", { name }));
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("defaults both locations to true, localizes EN/RU and patches actual BB settings through the public SDK", async () => {
  const { ring, updateSettings, persisted } = mount({ refreshOnHover: false, language: "en" });
  openSettings(ring);
  const interval = screen.getByRole("spinbutton", { name: "Refresh interval, seconds" }) as HTMLInputElement;
  expect(interval.value).toBe("120");
  expect((screen.getByRole("checkbox", { name: "Show in chat" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: "Show in left sidebar" }) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByRole("combobox")).toBeNull();
  fireEvent.change(interval, { target: { value: "0" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Show in left sidebar" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
  expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
    pluginId: "codex-quota", values: { refreshIntervalSeconds: 0, showInSidebar: false },
  });
  expect(persisted).toEqual({ refreshOnHover: false, language: "en", refreshIntervalSeconds: 0, showInSidebar: false });
  expect(screen.getByRole("status").textContent).toBe("Saved");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
  expect(updateSettings).toHaveBeenCalledTimes(1);

  cleanup();
  const russian = mount({ language: "ru", showInChat: false, showInSidebar: false, refreshIntervalSeconds: 300 });
  openSettings(russian.ring, "Настройки");
  expect(screen.getByRole("button", { name: "Назад" })).toBeTruthy();
  expect((screen.getByRole("spinbutton", { name: "Интервал обновления, сек." }) as HTMLInputElement).value).toBe("300");
  expect(screen.getByText(/Вернуть индикатор/)).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Показывать в чате" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Сохранить" })));
  expect(russian.updateSettings).toHaveBeenCalledExactlyOnceWith({ pluginId: "codex-quota", values: { showInChat: true } });
  expect(screen.getByRole("status").textContent).toBe("Сохранено");
});

it.each(["", "-1", "1.5", "2147484"])("rejects interval %j accessibly without persisting", value => {
  const { ring, updateSettings } = mount();
  openSettings(ring);
  const input = screen.getByRole("spinbutton");
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(updateSettings).not.toHaveBeenCalled();
  expect(input.getAttribute("aria-invalid")).toBe("true");
  const help = document.getElementById(input.getAttribute("aria-describedby")!);
  expect(help?.textContent).toContain("Enter a whole number");
  expect(document.activeElement).toBe(input);
});

it("waits for acknowledgement, prevents duplicate saves, and keeps edits on a sanitized failure for retry", async () => {
  const { ring, updateSettings } = mount();
  let reject!: (error: Error) => void;
  updateSettings.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  openSettings(ring);
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "300" } });
  fireEvent.submit(screen.getByRole("form", { name: "Settings" }));
  fireEvent.submit(screen.getByRole("form", { name: "Settings" }));
  expect(updateSettings).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status").textContent).toBe("");
  expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).matches(":disabled")).toBe(true);
  await act(async () => reject(new Error("private error body")));
  expect(screen.getByRole("alert").textContent).toBe("Could not save. Try again.");
  expect(document.body.textContent).not.toContain("private error body");
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("300");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
  expect(screen.getByRole("status").textContent).toBe("Saved");
});

it("pins only settings, transfers focus on turn/back, and resets unsaved drafts on Escape and rapid reopening", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { ring, updateSettings } = mount();
  const composer = screen.getByRole("textbox", { name: "Composer" });
  act(() => composer.focus());
  fireEvent.pointerOver(ring, { pointerType: "mouse" });
  expect(document.activeElement).toBe(composer);
  const details = screen.getByRole("button", { name: "Details" });
  fireEvent.pointerDown(details, { pointerType: "mouse", button: 0 });
  fireEvent.click(details);
  fireEvent.pointerLeave(screen.getByRole("dialog"), { pointerType: "mouse" });
  await act(async () => vi.advanceTimersByTimeAsync(201));
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.pointerOver(ring, { pointerType: "mouse" });
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" }));
  fireEvent.pointerLeave(screen.getByRole("dialog"), { pointerType: "mouse" });
  await act(async () => vi.advanceTimersByTimeAsync(201));
  expect(screen.getByRole("spinbutton")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const input = screen.getByRole("spinbutton");
  fireEvent.change(input, { target: { value: "300" } });
  act(() => input.focus());
  fireEvent.keyDown(input, { key: "Escape" });
  // Reopen immediately, without waiting for the popover's exit animation.
  fireEvent.click(ring);
  expect(screen.getByRole("heading", { name: "Codex · Pro" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("120");
  expect(updateSettings).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("button", { name: "Back" }), { key: "Escape" });
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(ring);
});

it("opens and navigates with touch without treating touch entry as hover", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { ring } = mount();
  const pointer = { pointerType: "touch", pointerId: 1, isPrimary: true };
  function tap(target: HTMLElement) {
    fireEvent.pointerOver(target, pointer);
    fireEvent.pointerDown(target, pointer);
    fireEvent.touchStart(target);
    fireEvent.pointerUp(target, pointer);
    fireEvent.touchEnd(target);
    fireEvent.click(target, { detail: 1 });
  }
  fireEvent.pointerOver(ring, pointer);
  expect(screen.queryByRole("dialog")).toBeNull();
  tap(ring);
  tap(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole("spinbutton")).toBeTruthy();
  tap(screen.getByRole("checkbox", { name: "Show in chat" }));
  expect((screen.getByRole("checkbox", { name: "Show in chat" }) as HTMLInputElement).checked).toBe(false);
  tap(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("heading", { name: "Codex · Pro" })).toBeTruthy();
  tap(ring);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.queryByRole("dialog")).toBeNull();
});
