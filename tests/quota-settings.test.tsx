// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, expect, it, vi } from "vitest";
import { QuotaPopover } from "../lib/quota-popover";
import { QuotaSettingsCard, type QuotaSettingsSurface } from "../lib/quota-settings";

const notify = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("sonner", () => ({ toast: notify }));

function Card({ surface }: { surface?: QuotaSettingsSurface }) {
  return <>
    <textarea aria-label="Composer" />
    <QuotaPopover label="Quota ring" title="Codex quota" onRefresh={() => {}} trigger="65%">
      <QuotaSettingsCard surface={surface}>{settingsButton => <>
        <div className="flex items-center">{settingsButton}<h3>Codex · Pro</h3></div>
        <p>Weekly: 65% left</p>
        <button type="button">Details</button>
      </>}</QuotaSettingsCard>
    </QuotaPopover>
  </>;
}

function mount(settings: RenderSlotOptions["settings"] = {}, surface?: QuotaSettingsSurface) {
  const persisted = { ...settings };
  const updateSettings = vi.fn(async ({ values }: { pluginId: string; values: Record<string, unknown> }) => {
    Object.assign(persisted, values);
    return { ok: true as const, schema: {}, values: { ...persisted } };
  });
  const slot = renderSlot({ component: Card }, { surface }, {
    pluginId: "codex-quota", settings,
    sdk: { plugins: { updateSettings } },
  });
  return { slot, updateSettings, persisted, ring: screen.getByRole("button", { name: "Quota ring" }) };
}

function openSettings(ring: HTMLElement, name = "Settings") {
  fireEvent.click(ring);
  fireEvent.click(screen.getByRole("button", { name }));
}

afterEach(() => { cleanup(); notify.success.mockReset(); vi.useRealTimers(); });

it("defaults both locations to true, localizes EN/RU and patches actual BB settings through the public SDK", async () => {
  const { ring, updateSettings, persisted } = mount({ refreshOnHover: false, language: "en" });
  openSettings(ring);
  const interval = screen.getByRole("spinbutton", { name: "Refresh interval, seconds" }) as HTMLInputElement;
  expect(interval.value).toBe("120");
  expect(document.getElementById(interval.getAttribute("aria-describedby")!)?.textContent).toBe("0 disables auto-refresh");
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect((screen.getByRole("switch", { name: "Ring in chat" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("switch", { name: "Ring in sidebar" }) as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(interval, { target: { value: "0" } });
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("switch", { name: "Ring in sidebar" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
  expect(updateSettings).toHaveBeenCalledExactlyOnceWith({
    pluginId: "codex-quota", values: { refreshIntervalSeconds: 0, showInSidebar: false },
  });
  expect(persisted).toEqual({ refreshOnHover: false, language: "en", refreshIntervalSeconds: 0, showInSidebar: false });
  expect(screen.getByRole("status").textContent).toBe("Saved");
  expect(screen.getByRole("button", { name: "Saved" }).contains(screen.getByRole("status"))).toBe(true);
  expect((screen.getByRole("button", { name: "Saved" }) as HTMLButtonElement).disabled).toBe(true);
  expect(notify.success).not.toHaveBeenCalled();
  await act(async () => fireEvent.submit(screen.getByRole("form", { name: "Settings" })));
  expect(updateSettings).toHaveBeenCalledTimes(1);

  cleanup();
  const russian = mount({ language: "ru", showInChat: false, showInSidebar: false, refreshIntervalSeconds: 300 });
  openSettings(russian.ring, "Настройки");
  expect(screen.getByRole("button", { name: "Назад" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Об автообновлении" })).toBeTruthy();
  expect((screen.getByRole("spinbutton", { name: "Обновление, секунды" }) as HTMLInputElement).value).toBe("300");
  fireEvent.click(screen.getByRole("switch", { name: "Кольцо в чате" }));
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
  const message = value === "2147484" ? "Maximum interval: 2,147,483 s." : "Enter a whole number, 0 or higher.";
  expect(help?.textContent).toBe(message);
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
  expect(screen.queryByRole("status")).toBeNull();
  expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).matches(":disabled")).toBe(true);
  await act(async () => reject(new Error("private error body")));
  expect(screen.getByRole("alert").textContent).toBe("Could not save. Try again.");
  expect(document.body.textContent).not.toContain("private error body");
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("300");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
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
  tap(screen.getByRole("switch", { name: "Ring in chat" }));
  expect((screen.getByRole("switch", { name: "Ring in chat" }) as HTMLInputElement).checked).toBe(false);
  tap(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("heading", { name: "Codex · Pro" })).toBeTruthy();
  tap(ring);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it.each([
  { surface: "chat" as const, current: "Ring in chat", other: "Ring in sidebar" },
  { surface: "sidebar" as const, current: "Ring in sidebar", other: "Ring in chat" },
])("toasts only when saving hides the current $surface ring, without an inline duplicate", async ({ surface, current, other }) => {
  const { ring, updateSettings } = mount({}, surface);
  openSettings(ring);
  fireEvent.click(screen.getByRole("switch", { name: other }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
  expect(screen.getByRole("status").textContent).toBe("Saved");
  expect(notify.success).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("switch", { name: current }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
  expect(notify.success).toHaveBeenCalledExactlyOnceWith("Saved", { id: "codex-quota:quota-settings-saved" });
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: "Saved" })).toBeNull();
  // A second submit with no edits never writes or announces again.
  await act(async () => fireEvent.submit(screen.getByRole("form", { name: "Settings" })));
  expect(updateSettings).toHaveBeenCalledTimes(2);
  expect(notify.success).toHaveBeenCalledTimes(1);
});

it("delivers the localized host toast after the saving card has unmounted", async () => {
  const { ring, slot, updateSettings } = mount({ language: "ru" });
  let confirm!: (result: { ok: true; schema: {}; values: { showInChat: false; language: string } }) => void;
  updateSettings.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
  openSettings(ring, "Настройки");
  fireEvent.click(screen.getByRole("switch", { name: "Кольцо в чате" }));
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  slot.lifecycle.unmount();
  await act(async () => confirm({ ok: true, schema: {}, values: { showInChat: false, language: "ru" } }));
  expect(notify.success).toHaveBeenCalledExactlyOnceWith("Сохранено", { id: "codex-quota:quota-settings-saved" });
  expect(screen.queryByRole("status")).toBeNull();
});

it("does not toast an unsuccessful hide and lets keyboard users retry", async () => {
  const { ring, updateSettings } = mount();
  updateSettings.mockRejectedValueOnce(new Error("private error body"));
  act(() => ring.focus());
  fireEvent.keyDown(ring, { key: "Enter" });
  // jsdom does not synthesize native button clicks from keyboard input.
  fireEvent.click(ring, { detail: 0 });
  const gear = screen.getByRole("button", { name: "Settings" });
  expect(gear.tagName).toBe("BUTTON");
  act(() => gear.focus());
  fireEvent.keyDown(gear, { key: " " });
  fireEvent.keyUp(gear, { key: " " });
  fireEvent.click(gear, { detail: 0 });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("switch", { name: "Ring in chat" }));
  await act(async () => fireEvent.submit(screen.getByRole("form", { name: "Settings" })));
  expect(notify.success).not.toHaveBeenCalled();
  const retry = screen.getByRole("button", { name: "Retry" });
  act(() => retry.focus());
  await act(async () => fireEvent.click(retry, { detail: 0 }));
  expect(notify.success).toHaveBeenCalledTimes(1);
});
