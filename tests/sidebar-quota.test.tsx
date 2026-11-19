// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComposerSelection, PluginAppBuilder, PluginComposerApi } from "@get-bb/plugin-sdk/app";
import type { ComponentType } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QuotaLocation } from "../server";

const state = vi.hoisted(() => ({
  settings: {} as Record<string, boolean>,
  composer: { scope: { kind: "thread", threadId: "main" }, selection: { providerId: "codex" } } as PluginComposerApi,
  composers: [] as PluginComposerApi[],
  context: { threadId: "main" as string | null },
  sdk: { threads: { get: vi.fn() } },
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_usePluginId: () => "codex-quota",
  useSettings: () => ({ values: state.settings }),
  useComposer: () => state.composer,
  useComposers: () => state.composers,
  useBbContext: () => state.context,
  useSdk: () => state.sdk,
}));
import { environmentLocation, mountSidebarQuota, registerSidebarQuota } from "../lib/sidebar-quota";

function select(selection: ComposerSelection) {
  state.composer = { ...state.composer, selection };
}

let dispose: (() => void) | undefined;
const anchorSelector = "[data-codex-quota-sidebar]";

function rail(mobile = false) {
  const panel = document.createElement("div");
  panel.dataset.sidebar = "panel";
  if (mobile) { panel.setAttribute("role", "dialog"); panel.dataset.state = "open"; }
  panel.innerHTML = `<div data-sidebar="sidebar"><div>
    <nav data-sidebar-navigation-placement="rail"></nav>
    <div class="col-start-1 row-start-2"><button aria-label="Settings"></button></div>
  </div></div>`;
  const inset = document.createElement("main");
  inset.dataset.sidebar = "inset";
  inset.dataset.sidebarShelf = "open";
  document.body.append(panel, inset);
  return { panel, inset, footer: panel.querySelector<HTMLElement>(".row-start-2")!, settings: panel.querySelector("button")! };
}

function showQuota() {
  let Overlay: ComponentType = () => null;
  const Quota = ({ location }: { location: QuotaLocation }) => <button aria-label="Quota">{JSON.stringify(location)}</button>;
  const register = vi.fn(({ component }: { component: ComponentType }) => { Overlay = component; });
  registerSidebarQuota({ slots: { experimental_appOverlay: register } } as unknown as PluginAppBuilder, Quota);
  expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: "sidebar-quota" }));
  const result = render(<Overlay />);
  return { ...result, update: () => result.rerender(<Overlay />) };
}

beforeEach(() => {
  state.settings = {};
  state.composer = { scope: { kind: "thread", threadId: "main" }, selection: { providerId: "codex" } } as PluginComposerApi;
  state.composers = [];
  state.context.threadId = "main";
  state.sdk.threads.get.mockReset();
});
afterEach(() => { cleanup(); dispose?.(); dispose = undefined; document.body.replaceChildren(); });

it("places one shared control above Settings by default, independently of the chat ring", async () => {
  const layout = rail();
  state.settings.showInChat = false;
  const view = showQuota();
  expect(await screen.findByRole("button", { name: "Quota" })).toBeTruthy();
  const anchor = document.querySelector(anchorSelector)!;
  expect(anchor.nextElementSibling).toBe(layout.settings);
  expect(layout.footer.style.flexDirection).toBe("column");
  expect(anchor.getAttribute("data-bb-plugin")).toBe("codex-quota");
  expect(anchor.textContent).toBe('{"threadId":"main"}');
  expect(state.sdk.threads.get).not.toHaveBeenCalled();
  state.settings.showInSidebar = false;
  view.update();
  expect(screen.queryByRole("button", { name: "Quota" })).toBeNull();
  expect(document.querySelector(anchorSelector)).toBeNull();
  expect(layout.footer.style.flexDirection).toBe("");
  state.settings.showInSidebar = true;
  view.update();
  expect(await screen.findByRole("button", { name: "Quota" })).toBeTruthy();
});

it("follows the live rail when rebuilt and restores the footer's original inline style", async () => {
  const first = rail();
  first.footer.style.setProperty("flex-direction", "row-reverse", "important");
  const targets: (HTMLElement | null)[] = [];
  dispose = mountSidebarQuota("codex-quota", target => targets.push(target));
  expect(first.settings.previousElementSibling?.matches(anchorSelector)).toBe(true);
  first.panel.remove();
  const second = rail();
  await waitFor(() => expect(second.settings.previousElementSibling?.matches(anchorSelector)).toBe(true));
  expect(first.footer.style.flexDirection).toBe("row-reverse");
  expect(first.footer.style.getPropertyPriority("flex-direction")).toBe("important");
  expect(document.querySelectorAll(anchorSelector)).toHaveLength(1);
  dispose();
  expect(targets.at(-1)).toBeNull();
  expect(second.footer.style.flexDirection).toBe("");
  expect(second.settings.isConnected).toBe(true);
});

it("unmounts quota when the mobile shelf closes or the desktop sidebar is hidden", async () => {
  const { panel, inset } = rail(true);
  showQuota();
  expect(await screen.findByRole("button", { name: "Quota" })).toBeTruthy();
  inset.dataset.sidebarShelf = "closed";
  await waitFor(() => expect(screen.queryByRole("button", { name: "Quota" })).toBeNull());
  expect(document.querySelector(anchorSelector)).toBeNull();
  inset.dataset.sidebarShelf = "open";
  expect(await screen.findByRole("button", { name: "Quota" })).toBeTruthy();
  panel.dataset.collapsible = "offcanvas";
  await waitFor(() => expect(screen.queryByRole("button", { name: "Quota" })).toBeNull());
  panel.dataset.collapsible = "rail";
  expect(await screen.findByRole("button", { name: "Quota" })).toBeTruthy();
});

it("does not decorate a top-list footer or resolve context while the sidebar is hidden", () => {
  const { panel } = rail();
  panel.querySelector("nav")!.dataset.sidebarNavigationPlacement = "list";
  select({ providerId: "other" });
  showQuota();
  expect(document.querySelector(anchorSelector)).toBeNull();
  expect(state.sdk.threads.get).not.toHaveBeenCalled();
});

it("uses the single Codex side composer on a non-Codex main page and rejects ambiguous sides", async () => {
  rail();
  select({ providerId: "other" });
  state.composers = [{ scope: { kind: "thread", threadId: "side" }, selection: { providerId: "codex" } } as PluginComposerApi];
  const view = showQuota();
  expect((await screen.findByRole("button", { name: "Quota" })).textContent).toBe('{"threadId":"side"}');
  state.composers = [...state.composers, { scope: { kind: "thread", threadId: "another" }, selection: { providerId: "codex" } } as PluginComposerApi];
  state.sdk.threads.get.mockResolvedValue({ providerId: "other", environmentId: "known-environment" });
  view.update();
  await waitFor(() => expect(screen.getByRole("button", { name: "Quota" }).textContent).toBe('{"environmentId":"known-environment"}'));
});

it("shows Codex quota of an explicitly selected environment on a non-Codex new chat", async () => {
  rail();
  state.context.threadId = null;
  state.composer.scope = { kind: "new-thread", projectId: null };
  select({ providerId: "other", environment: { type: "host", hostId: "selected-machine", workspace: { type: "unmanaged", path: null } } });
  const view = showQuota();
  expect((await screen.findByRole("button", { name: "Quota" })).textContent).toBe('{"hostId":"selected-machine"}');
  select({ providerId: "other", environment: { type: "host", workspace: { type: "unmanaged", path: null } } });
  view.update();
  expect(screen.queryByRole("button", { name: "Quota" })).toBeNull();
  expect(document.querySelector<HTMLElement>(anchorSelector)?.style.display).toBe("none");
  expect(state.sdk.threads.get).not.toHaveBeenCalled();
});

it("does not flash the previous environment or accept a late route response", async () => {
  rail();
  select({ providerId: "other" });
  let resolveOld!: (value: unknown) => void;
  state.sdk.threads.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const view = showQuota();
  await waitFor(() => expect(state.sdk.threads.get).toHaveBeenCalledWith({ threadId: "main" }));
  state.context.threadId = "next";
  state.composer.scope = { kind: "thread", threadId: "next" };
  state.sdk.threads.get.mockResolvedValue({ providerId: "other", environmentId: "next-env" });
  view.update();
  await waitFor(() => expect(screen.getByRole("button", { name: "Quota" }).textContent).toBe('{"environmentId":"next-env"}'));
  resolveOld({ providerId: "other", environmentId: "previous-env" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Quota" }).textContent).toBe('{"environmentId":"next-env"}'));
  state.context.threadId = null;
  view.update();
  expect(screen.queryByRole("button", { name: "Quota" })).toBeNull();
});

it("maps only explicitly known environments and machines", () => {
  expect(environmentLocation({ type: "reuse", environmentId: "env" })).toEqual({ environmentId: "env" });
  expect(environmentLocation({ type: "provider", environmentProviderId: "remote", inputs: {}, machine: { type: "existing", hostId: "remote-host" } })).toEqual({ hostId: "remote-host" });
  expect(environmentLocation({ type: "project-default" })).toBeNull();
  expect(environmentLocation(undefined)).toBeNull();
});
