import type { PluginContentScriptContext } from "@get-bb/plugin-sdk/app";

function findPlacementTarget(origin: HTMLElement) {
  const shell = origin.closest('[data-app-composer-role="primary"][data-promptbox-shell]');
  const composer = shell?.querySelector(':scope > [data-follow-up-composer-anchor] > [data-follow-up-composer]');
  if (!composer) return null;

  const context = composer.querySelector<HTMLElement>(
    ':scope > [data-follow-up-composer-footer] :is(button[aria-label^="Context window"], button[title^="Context window"])',
  );
  // Before a context reading exists and in compact layouts, use the same composer’s submit group.
  return context ?? composer.querySelector<HTMLElement>(
    ':scope > [data-composer-box] form[data-promptbox] [data-promptbox-submit-group]',
  );
}

// BB exposes composer actions but no slot beside the context meter yet.
// This content script owns only our portal anchors; host controls stay intact.
export function mountUsageFooter({ pluginId }: PluginContentScriptContext) {
  const anchors = new Map<HTMLElement, HTMLElement>();
  let frame = 0;

  function createAnchor(origin: HTMLElement) {
    const anchor = document.createElement("span");
    anchor.dataset.bbPluginRoot = "";
    anchor.dataset.bbPlugin = pluginId;
    anchor.dataset.codexQuotaFooter = "";
    anchor.style.display = "inline-flex";
    anchor.style.alignItems = "center";
    anchors.set(origin, anchor);
    return anchor;
  }

  function removeAnchor(origin: HTMLElement, anchor: HTMLElement) {
    anchor.remove();
    anchors.delete(origin);
  }

  function place(force?: boolean) {
    for (const [origin, anchor] of anchors) {
      if (!origin.isConnected) removeAnchor(origin, anchor);
    }
    for (const origin of document.querySelectorAll<HTMLElement>("[data-codex-quota-origin]")) {
      const target = findPlacementTarget(origin);
      const existingAnchor = anchors.get(origin);
      if (!target) {
        if (existingAnchor) {
          removeAnchor(origin, existingAnchor);
          notify(origin, null);
        }
        continue;
      }
      const anchor = existingAnchor ?? createAnchor(origin);
      const needsPlacement = anchor.nextElementSibling !== target;
      if (needsPlacement) target.before(anchor);
      if (needsPlacement || force) notify(origin, anchor);
    }
  }
  function notify(origin: HTMLElement, target: HTMLElement | null) {
    document.dispatchEvent(new CustomEvent("codex-quota:footer-placed", { detail: { origin, target } }));
  }
  const request = () => place(true);
  const observer = new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; place(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("codex-quota:place-footer", request);
  place();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    document.removeEventListener("codex-quota:place-footer", request);
    for (const anchor of anchors.values()) anchor.remove();
    anchors.clear();
  };
}
