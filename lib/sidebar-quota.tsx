import { useEffect, useLayoutEffect, useMemo, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import {
  experimental_usePluginId, useBbContext, useComposer, useComposers, useSdk, useSettings,
  type ComposerSelection, type PluginAppBuilder, type PluginComposerApi,
} from "@get-bb/plugin-sdk/app";
import type { QuotaLocation } from "../server";

type QuotaComponent = ComponentType<{ location: QuotaLocation; surface: "sidebar" }>;

export function environmentLocation(environment: ComposerSelection["environment"]): QuotaLocation | null {
  switch (environment?.type) {
    case "reuse": return environment.environmentId ? { environmentId: environment.environmentId } : null;
    case "host": return environment.hostId ? { hostId: environment.hostId } : null;
    case "provider": return environment.machine?.type === "existing" && environment.machine.hostId
      ? { hostId: environment.machine.hostId } : null;
    default: return null;
  }
}

function composerLocation(composer: PluginComposerApi): QuotaLocation | null {
  if (composer.selection?.providerId !== "codex") return null;
  return composer.scope.kind === "new-thread"
    ? environmentLocation(composer.selection.environment)
    : { threadId: composer.scope.threadId };
}

function selectedLocation(current: PluginComposerApi, composers: readonly PluginComposerApi[]) {
  // An explicit current Codex selection wins. Otherwise use an unambiguous
  // on-screen Codex composer (including ThreadChat on a non-Codex page).
  const direct = composerLocation(current);
  const candidates = composers.map(composerLocation).filter(location => location !== null);
  const distinct = new Map(candidates.map(location => [JSON.stringify(location), location]));
  if (direct) return direct;
  if (distinct.size === 1) return distinct.values().next().value ?? null;
  return current.scope.kind === "new-thread" ? environmentLocation(current.selection?.environment) : null;
}

function useStableLocation(selected: QuotaLocation | null) {
  const hostId = selected && "hostId" in selected ? selected.hostId : null;
  const environmentId = selected && "environmentId" in selected ? selected.environmentId : null;
  const selectedThreadId = selected && "threadId" in selected ? selected.threadId : null;
  // Preserve location identity across composer text edits: useQuota keys its
  // polling effect by this object. No draft text or account data is retained.
  return useMemo(() => {
    if (hostId) return { hostId };
    if (environmentId) return { environmentId };
    return selectedThreadId ? { threadId: selectedThreadId } : null;
  }, [hostId, environmentId, selectedThreadId]);
}

function useThreadLocation(threadId: string | null, enabled: boolean) {
  const sdk = useSdk();
  const [resolved, setResolved] = useState<{ threadId: string; location: QuotaLocation | null } | null>(null);
  useEffect(() => {
    if (!enabled || !threadId) return;
    let active = true;
    void sdk.threads.get({ threadId }).then(thread => {
      if (active) setResolved({ threadId, location: thread.providerId === "codex"
        ? { threadId }
        : thread.environmentId ? { environmentId: thread.environmentId } : null });
    }).catch(() => { if (active) setResolved({ threadId, location: null }); });
    return () => { active = false; };
  }, [enabled, sdk, threadId]);
  return resolved?.threadId === threadId ? resolved?.location ?? null : null;
}

function useSidebarLocation(enabled: boolean): QuotaLocation | null {
  const current = useComposer();
  const composers = useComposers();
  const { threadId } = useBbContext();
  const selected = useStableLocation(selectedLocation(current, composers));
  const fromThread = useThreadLocation(threadId, enabled && !selected && current.scope.kind !== "new-thread");
  if (!enabled) return null;
  // An unresolved/new machine is never replaced by an arbitrary known host.
  // Without a selected composer/machine or route thread (system pages), hide.
  return selected ?? fromThread;
}

function panelVisible(panel: HTMLElement | null) {
  if (!panel || document.hidden || panel.hidden || panel.getAttribute("aria-hidden") === "true") return false;
  if (panel.getAttribute("role") === "dialog" &&
    document.querySelector('[data-sidebar="inset"]')?.getAttribute("data-sidebar-shelf") !== "open") return false;
  if (panel.closest('[data-collapsible="offcanvas"]')) return false;
  const style = getComputedStyle(panel);
  return style.display !== "none" && style.visibility !== "hidden";
}

function railSettings() {
  // Observed BB rail DOM, wide and mobile shelf. Do not claim the exclusive
  // navigation-provider slot, or accidentally insert into the top-list footer.
  const rails = document.querySelectorAll<HTMLElement>('[data-sidebar-navigation-placement="rail"]');
  for (const rail of rails) {
    const grid = rail.parentElement;
    const footer = grid?.querySelector<HTMLElement>(":scope > .col-start-1.row-start-2");
    const settings = footer?.querySelector<HTMLButtonElement>(":scope > button");
    if (!footer || !settings) continue;
    const panel = rail.closest<HTMLElement>('[data-sidebar="panel"]');
    if (!panelVisible(panel)) continue;
    return { footer, settings };
  }
  return null;
}

/** Mounts only a plugin-owned anchor; restores the host footer on removal. */
export function mountSidebarQuota(pluginId: string, onTarget: (target: HTMLElement | null) => void) {
  let placement: { footer: HTMLElement; settings: HTMLElement; direction: string; priority: string } | null = null;
  let anchor: HTMLSpanElement | null = null;
  let frame = 0;
  function clear() {
    if (!anchor) return;
    onTarget(null);
    anchor.remove();
    anchor = null;
    if (placement?.footer.style.flexDirection === "column") {
      if (placement.direction) placement.footer.style.setProperty("flex-direction", placement.direction, placement.priority);
      else placement.footer.style.removeProperty("flex-direction");
    }
    placement = null;
  }
  function place() {
    const next = railSettings();
    if (!next) { clear(); return; }
    if (next.footer === placement?.footer && next.settings === placement.settings && anchor?.isConnected) {
      if (anchor.nextElementSibling !== next.settings) next.settings.before(anchor);
      return;
    }
    clear();
    placement = { ...next, direction: next.footer.style.getPropertyValue("flex-direction"),
      priority: next.footer.style.getPropertyPriority("flex-direction") };
    next.footer.style.flexDirection = "column";
    anchor = document.createElement("span");
    anchor.dataset.bbPluginRoot = "";
    anchor.dataset.bbPlugin = pluginId;
    anchor.dataset.codexQuotaSidebar = "";
    // The shared trigger is 32px with -4px margins. This supplies a full rail
    // control row without changing its hover, keyboard or popover behavior.
    Object.assign(anchor.style, { display: "none", alignItems: "center", justifyContent: "center",
      width: "var(--bb-sidebar-control-size, 32px)", minHeight: "36px", flexShrink: "0" });
    next.settings.before(anchor);
    onTarget(anchor);
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; place(); }); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden", "data-state", "data-collapsible", "data-sidebar-shelf"] });
  window.addEventListener("resize", schedule);
  document.addEventListener("visibilitychange", schedule);
  place();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", schedule);
    document.removeEventListener("visibilitychange", schedule);
    clear();
  };
}

function SidebarQuota({ Quota }: { Quota: QuotaComponent }) {
  const { values } = useSettings();
  const pluginId = experimental_usePluginId();
  const enabled = values?.showInSidebar !== false;
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (enabled) return mountSidebarQuota(pluginId, setTarget);
  }, [enabled, pluginId]);
  const location = useSidebarLocation(enabled && target !== null);
  useLayoutEffect(() => {
    if (target) target.style.display = location ? "flex" : "none";
  }, [target, location]);
  return enabled && target && location
    ? createPortal(<Quota key={JSON.stringify(location)} location={location} surface="sidebar" />, target) : null;
}

/** Call inside definePluginApp; ComposerQuota supplies the existing ring/card. */
export function registerSidebarQuota(app: PluginAppBuilder, Quota: QuotaComponent) {
  app.slots.experimental_appOverlay({ id: "sidebar-quota", component: () => <SidebarQuota Quota={Quota} /> });
}
