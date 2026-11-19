import type { PluginContentScriptContext } from "@get-bb/plugin-sdk/app";

const composerShell = '[data-app-composer-role][data-promptbox-shell]';
const compactAnchor = 'data-codex-quota-footer-compact';

type Placement = { before: boolean; sibling: Element; compact?: boolean };

function findCollapsedAction(shell: Element) {
  const row = shell.querySelector(
    'form[data-promptbox][data-promptbox-compact][data-promptbox-collapsed] [data-promptbox-main] > [data-promptbox-action-row]',
  );
  return row?.closest(composerShell) === shell ? row : null;
}

function findPlacementTarget(origin: HTMLElement) {
  const shell = origin.closest(composerShell);
  if (!shell) return null;
  const action = findCollapsedAction(shell);
  return action ? { before: true, sibling: action, compact: true } : findFooterTarget(shell);
}

function findFooterTarget(shell: Element): Placement | null {
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

function placeBeside(anchor: HTMLElement, { before, sibling, compact = false }: Placement) {
  anchor.toggleAttribute(compactAnchor, compact);
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
  const compactStyle = document.createElement("style");
  compactStyle.textContent = `
    [${compactAnchor}] {
      flex-shrink: 0;
      margin-inline: 4px;
    }
    [${compactAnchor}] > button {
      width: 44px;
      height: 44px;
      margin: 0;
    }
  `;
  document.head.append(compactStyle);

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
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributeFilter: ["data-promptbox-compact", "data-promptbox-collapsed"],
  });
  document.addEventListener("codex-quota:place-footer", request);
  place();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    document.removeEventListener("codex-quota:place-footer", request);
    compactStyle.remove();
    for (const anchor of anchors.values()) anchor.remove();
    anchors.clear();
  };
}
