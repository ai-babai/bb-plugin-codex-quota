// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Quota, QuotaWindow } from "../server";
import { mountUsageFooter } from "../lib/usage-footer";

const { rpc, customize, register, settings, composer } = vi.hoisted(() => ({
  rpc: { call: vi.fn() },
  customize: vi.fn(),
  register: vi.fn(),
  settings: { values: { language: "en", refreshIntervalSeconds: 0, refreshOnHover: true, refreshOnPress: true } },
  composer: { scope: { kind: "thread", threadId: "example" }, selection: { providerId: "codex" } },
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  definePluginApp: (initialize: (app: object) => void) => initialize({
    composer: { customize }, contentScripts: { register },
  }),
  useComposer: () => composer,
  useSettings: () => settings,
  useRpc: () => rpc,
  experimental_Icon: () => null,
}));
import "../app";

const Disk: ComponentType = customize.mock.calls[0][0].banners[0].component;
const mount: typeof mountUsageFooter = register.mock.calls[0][0].mount;
let dispose: () => void;

function showDisk() {
  dispose = mount({ pluginId: "codex-quota" } as Parameters<typeof mount>[0]);
  return render(
    <div data-app-composer-role="primary" data-promptbox-shell="">
      <Disk />
      <div data-follow-up-composer-anchor="">
        <div data-follow-up-composer="">
          <div data-follow-up-composer-footer=""><button aria-label="Context window" /></div>
        </div>
      </div>
    </div>,
  );
}

function quota(windows: QuotaWindow[], observedAt = Date.now()): Quota {
  return { error: null, account: { plan: "Pro", observedAt, windows } };
}

function windowData(kind: QuotaWindow["kind"], remaining: number, untilHours: number | null): QuotaWindow {
  return { id: kind, kind, label: "Project limit", remaining,
    resetsAt: untilHours === null ? null : new Date(Date.now() + untilHours * 3_600_000).toISOString() };
}

function respondWith(data: Quota) {
  rpc.call.mockImplementation(async (method: string) => method === "quota" ? data : { count: 2 });
}

beforeEach(() => {
  rpc.call.mockReset();
  composer.selection.providerId = "codex";
  Object.assign(settings.values, { language: "en", refreshOnHover: true, refreshOnPress: true });
});

afterEach(() => { cleanup(); dispose(); });

it("places the ring beside context, shows the tightest limit and each reported reset", async () => {
  respondWith(quota([windowData("five-hour", 78, 3), windowData("weekly", 46, 52),
    windowData("daily", 90, 12), windowData("custom", 100, null)]));
  showDisk();
  const ring = await screen.findByRole("button", { name: "Codex subscription: 46% left" });
  expect(ring.parentElement?.nextElementSibling).toBe(screen.getByRole("button", { name: "Context window" }));
  fireEvent.pointerOver(ring, { pointerType: "mouse" });
  expect(await screen.findByRole("heading", { name: "Codex · Pro" })).toBeTruthy();
  expect(screen.getAllByRole("meter").map(meter => [meter.getAttribute("aria-label"), meter.getAttribute("aria-valuenow")]))
    .toEqual([["5 hours: left", "78"], ["Weekly: left", "46"], ["Daily: left", "90"], ["Project limit: left", "100"]]);
  expect(screen.getAllByText("Resets in")).toHaveLength(3);
  expect(rpc.call).toHaveBeenCalledWith("quota", { threadId: "example", refresh: true });
});

it("uses the saved language and refresh triggers and marks elapsed windows stale", async () => {
  Object.assign(settings.values, { language: "ru", refreshOnHover: false, refreshOnPress: true });
  respondWith(quota([windowData("weekly", 10, -1), windowData("daily", 20, 3)]));
  showDisk();
  const ring = await screen.findByRole("button", { name: "Подписка Codex: Лимиты недоступны" });
  fireEvent.pointerOver(ring, { pointerType: "mouse" });
  expect(await screen.findByText("Ожидаем обновления квоты")).toBeTruthy();
  expect(screen.getByText("10% осталось · устарело")).toBeTruthy();
  expect(rpc.call).not.toHaveBeenCalledWith("quota", { threadId: "example", refresh: true });
  fireEvent.click(ring);
  expect(rpc.call).toHaveBeenCalledWith("quota", { threadId: "example", refresh: true });
});

it("distinguishes waiting for the first read from a failed read", async () => {
  settings.values.refreshOnHover = false;
  let finish!: (quota: Quota) => void;
  rpc.call.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  showDisk();
  const ring = await screen.findByRole("button", { name: "Codex subscription: Quota unavailable" });
  fireEvent.pointerOver(ring, { pointerType: "mouse" });
  expect(screen.getByRole("status").textContent).toBe("Loading quota…");
  await act(async () => finish({ account: null, error: "refresh_failed" }));
  expect(screen.getByRole("status").textContent).toBe("Quota unavailable");
});

it("leaves other providers' composers alone", () => {
  composer.selection.providerId = "other";
  showDisk();
  expect(screen.queryByRole("button", { name: /Codex/ })).toBeNull();
  expect(rpc.call).not.toHaveBeenCalled();
});
