import type { PluginContentScriptContext } from "@get-bb/plugin-sdk/app";

function findPlacementTarget(origin: HTMLElement) {
  const shell = origin.closest('[data-app-composer-role="primary"][data-promptbox-shell]');
  if (!shell) return null;
  const composer = shell.querySelector(':scope > [data-follow-up-composer-anchor] > [data-follow-up-composer]');
  const footer = composer?.querySelector(':scope > [data-follow-up-composer-footer]')
    ?? shell.querySelector(':scope > [data-new-thread-footer]');
  const context = footer?.querySelector('button:is([aria-label^="Context window"], [title^="Context window"])');
  if (context) return { before: true, sibling: context };
  const permissions = footer?.querySelector('button:is([aria-label="Permission mode"], [title="Permission mode"])');
  if (permissions) return { before: false, sibling: permissions };
  const submit = composer?.querySelector(':scope > [data-composer-box] form[data-promptbox-compact] [data-promptbox-submit-group]');
  return submit ? { before: true, sibling: submit } : null;
}

function placeBeside(anchor: HTMLElement, { before, sibling }: { before: boolean; sibling: Element }) {
  if ((before ? sibling.previousElementSibling : sibling.nextElementSibling) === anchor) return false;
  if (before) sibling.before(anchor);
  else sibling.after(anchor);
  return true;
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
      const moved = placeBeside(anchor, target);
      if (moved || force) notify(origin, anchor);
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
