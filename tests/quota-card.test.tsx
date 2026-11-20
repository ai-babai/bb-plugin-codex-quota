// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComposerSelection } from "@get-bb/plugin-sdk/app";
import type { ComponentType } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Quota, QuotaLocation, QuotaWindow } from "../server";
import { mountUsageFooter } from "../lib/usage-footer";

const { rpc, client, customize, register, settings, composer } = vi.hoisted(() => ({
  rpc: { call: vi.fn() },
  client: { current: {} as { call: ReturnType<typeof vi.fn> } },
  customize: vi.fn(),
  register: vi.fn(),
  settings: { values: { language: "en", showInChat: true, refreshIntervalSeconds: 0, refreshOnHover: true, refreshOnPress: true } },
  composer: { scope: { kind: "thread", threadId: "example" }, selection: { providerId: "codex" } as ComposerSelection },
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  definePluginApp: (initialize: (app: object) => void) => initialize({
    composer: { customize }, contentScripts: { register }, slots: { experimental_appOverlay: vi.fn() },
  }),
  useComposer: () => composer,
  useSettings: () => settings,
  useRpc: () => client.current,
  useRealtimeConnectionState: () => "connected",
  experimental_Icon: () => null,
}));
import "../app";

const Disk: ComponentType = customize.mock.calls.find(([registration]) => registration.scopes.includes("thread"))![0].banners[0].component;
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

const providers = [{ id: "codex", label: "Codex", capabilities: { resets: true } }];
let fixtureRun = 0;

function fixtureSource(location: QuotaLocation) {
  if ("threadId" in location) return `fixture:${fixtureRun}:thread:${location.threadId}`;
  if ("environmentId" in location) return `fixture:${fixtureRun}:environment:${location.environmentId}`;
  return `fixture:${fixtureRun}:host:${location.hostId}`;
}

function respondWithRead(read: () => Quota | Promise<Quota>) {
  rpc.call.mockImplementation(async (method: string, input: QuotaLocation & { expectedSourceKey?: string }) => {
    if (method === "listProviders") return { providers };
    const sourceKey = fixtureSource(input);
    if (method === "resolveSource") return { sourceKey };
    expect(input.expectedSourceKey).toBe(sourceKey);
    if (method === "quota") return read();
    if (method === "availableResets") return { count: 2 };
    throw new Error(`Unexpected RPC: ${method}`);
  });
}

function respondWith(data: Quota) {
  respondWithRead(() => data);
}

const threadLocation = { threadId: "example", providerId: "codex" };
const threadRefresh = () => ({ ...threadLocation, expectedSourceKey: fixtureSource(threadLocation), refresh: true });

beforeEach(() => {
  fixtureRun++;
  rpc.call.mockReset();
  client.current = { call: rpc.call };
  rpc.call.mockResolvedValue({ providers });
  composer.selection.providerId = "codex";
  Object.assign(settings.values, { language: "en", showInChat: true, refreshOnHover: true, refreshOnPress: true });
});

afterEach(() => { cleanup(); dispose?.(); });

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
  expect(await screen.findByRole("button", { name: "Available resets: 2" })).toBeTruthy();
  expect(rpc.call).toHaveBeenCalledWith("availableResets", {
    ...threadLocation, expectedSourceKey: fixtureSource(threadLocation), includeExpiries: false,
  });
  expect(rpc.call).toHaveBeenCalledWith("quota", threadRefresh());
});

it("uses the saved language and refresh triggers and marks elapsed windows stale", async () => {
  Object.assign(settings.values, { language: "ru", refreshOnHover: false, refreshOnPress: true });
  respondWith(quota([windowData("weekly", 10, -1), windowData("daily", 20, 3)]));
  showDisk();
  const ring = await screen.findByRole("button", { name: "Подписка Codex: Лимиты недоступны" });
  expect(ring.querySelector("svg text")?.textContent).toBe("?");
  rpc.call.mockClear();
  fireEvent.pointerOver(ring, { pointerType: "mouse" });
  expect(await screen.findByText("Ожидаем обновления квоты")).toBeTruthy();
  expect(screen.getByRole("meter", { name: "Неделя: осталось" }).closest(".grid")
    ?.querySelector("[data-codex-quota-remaining]")?.textContent).toBe("10% осталось · устарело");
  expect(rpc.call).not.toHaveBeenCalledWith("quota", threadRefresh());
  fireEvent.click(ring);
  await waitFor(() => expect(rpc.call).toHaveBeenCalledWith("quota", threadRefresh()));
});

it("distinguishes waiting for the first read from a failed read", async () => {
  settings.values.refreshOnHover = false;
  let finish!: (quota: Quota) => void;
  const pending = new Promise<Quota>(resolve => { finish = resolve; });
  respondWithRead(() => pending);
  showDisk();
  const ring = await screen.findByRole("button", { name: "Codex subscription: Loading quota…" });
  expect(ring.querySelector("svg text")).toBeNull();
  expect(ring.querySelector("svg")?.childElementCount).toBeGreaterThan(1);
  fireEvent.pointerOver(ring, { pointerType: "mouse" });
  expect(screen.getByRole("status").textContent).toBe("Loading quota…");
  await waitFor(() => expect(rpc.call).toHaveBeenCalledWith("quota", threadRefresh()));
  await act(async () => finish({ account: null, error: "refresh_failed" }));
  const unavailableRing = await screen.findByRole("button", { name: "Codex subscription: Quota unavailable" }, { timeout: 3_000 });
  expect(unavailableRing.querySelector("svg text")?.textContent).toBe("?");
  expect(screen.getByRole("status").textContent).toBe("Quota unavailable");
});

it("keeps the last measured ring and card visible during a refresh", async () => {
  let finish!: (quota: Quota) => void;
  const pending = new Promise<Quota>(resolve => { finish = resolve; });
  const read = vi.fn<() => Promise<Quota>>()
    .mockResolvedValueOnce(quota([windowData("weekly", 46, 52)]))
    .mockReturnValueOnce(pending);
  respondWithRead(read);
  showDisk();
  const ring = await screen.findByRole("button", { name: "Codex subscription: 46% left" });
  fireEvent.click(ring);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("button", { name: "Codex subscription: 46% left" })).toBe(ring);
  expect(screen.getByRole("meter", { name: "Weekly: left" }).getAttribute("aria-valuenow")).toBe("46");
  expect(screen.queryByText("Loading quota…")).toBeNull();

  await act(async () => finish(quota([windowData("weekly", 22, 52)])));
  expect(screen.getByRole("button", { name: "Codex subscription: 22% left" })).toBe(ring);
  expect(screen.getByRole("meter", { name: "Weekly: left" }).getAttribute("aria-valuenow")).toBe("22");
});

it("hides the composer ring and skips quota reads when chat placement is disabled", () => {
  settings.values.showInChat = false;
  showDisk();
  expect(screen.queryByRole("button", { name: /Codex/ })).toBeNull();
  expect(rpc.call).not.toHaveBeenCalled();
});

it("leaves unregistered providers' composers alone", async () => {
  composer.selection.providerId = "other";
  showDisk();
  expect(screen.queryByRole("button", { name: /Codex/ })).toBeNull();
  await waitFor(() => expect(rpc.call).toHaveBeenCalledWith("listProviders", {}));
  expect(rpc.call.mock.calls.some(([method]) => method === "quota")).toBe(false);
});

it("shows the selected machine’s limits before the first prompt and clears them when the selection changes", async () => {
  const DraftDisk: ComponentType = customize.mock.calls.find(([r]) => r.scopes.includes("new-thread"))![0].banners[0].component;
  const environment = (hostId: string) => ({ type: "provider", environmentProviderId: "project-checkout",
    machine: { type: "existing", hostId }, inputs: null } as const);
  respondWith(quota([windowData("weekly", 65, 52)]));
  composer.selection.environment = environment("host-a");
  dispose = mount({ pluginId: "codex-quota" } as Parameters<typeof mount>[0]);
  const draft = () => <div data-app-composer-role="primary" data-promptbox-shell="">
    <DraftDisk /><form data-promptbox="" />
    <div data-new-thread-footer=""><button aria-label="Permission mode" /></div>
  </div>;
  const view = render(draft());
  const ring = await screen.findByRole("button", { name: /65% left/ });
  expect(screen.getByRole("button", { name: "Permission mode" }).nextElementSibling?.contains(ring)).toBe(true);
  expect(rpc.call).toHaveBeenCalledWith("quota", { hostId: "host-a", providerId: "codex", expectedSourceKey: fixtureSource({ hostId: "host-a" }), refresh: true });
  composer.selection.environment = { type: "reuse", environmentId: "env-b" };
  respondWith(quota([windowData("weekly", 20, 52)]));
  view.rerender(draft());
  expect(screen.queryByRole("button", { name: /65% left/ })).toBeNull();
  await screen.findByRole("button", { name: /20% left/ });
  expect(rpc.call).toHaveBeenCalledWith("quota", { environmentId: "env-b", providerId: "codex", expectedSourceKey: fixtureSource({ environmentId: "env-b" }), refresh: true });
  composer.selection.environment = { type: "host", hostId: "host-c", workspace: { type: "personal" } };
  view.rerender(draft());
  await screen.findByRole("button", { name: /20% left/ });
  expect(rpc.call).toHaveBeenCalledWith("quota", { hostId: "host-c", providerId: "codex", expectedSourceKey: fixtureSource({ hostId: "host-c" }), refresh: true });
  rpc.call.mockClear();
  composer.selection.environment = { type: "project-default" };
  view.rerender(draft());
  expect(screen.queryByRole("button", { name: /Codex/ })).toBeNull();
  composer.selection.environment = environment("host-a");
  composer.selection.providerId = "other";
  view.rerender(draft());
  expect(screen.queryByRole("button", { name: /Codex/ })).toBeNull();
  expect(rpc.call).not.toHaveBeenCalled();
});
