import type { PluginContentScriptContext } from "@get-bb/plugin-sdk/app";

// BB exposes composer actions but no slot beside the context meter yet.
// This content script owns only our portal anchors; host controls stay intact.
export function mountUsageFooter({ pluginId }: PluginContentScriptContext) {
  const anchors = new Map<HTMLElement, HTMLElement>();
  let frame = 0;
  function place(force = false) {
    for (const [origin, anchor] of anchors) {
      if (!origin.isConnected) { anchor.remove(); anchors.delete(origin); }
    }
    for (const origin of Array.from(document.querySelectorAll<HTMLElement>("[data-codex-quota-origin]"))) {
      let container = origin.parentElement;
      let context: HTMLElement | null = null;
      while (container && container !== document.body) {
        context = container.querySelector<HTMLElement>('button[aria-label^="Context window"], button[title^="Context window"]');
        if (context || container.querySelector('button[aria-label="Permission mode"]')) break;
        container = container.parentElement;
      }
      let anchor = anchors.get(origin);
      if (!context) {
        if (anchor) {
          anchor.remove();
          anchors.delete(origin);
          notify(origin, null);
        }
        continue;
      }
      const changed = !anchor || anchor.nextElementSibling !== context;
      if (!anchor) {
        anchor = document.createElement("span");
        anchor.dataset.bbPluginRoot = "";
        anchor.dataset.bbPlugin = pluginId;
        anchor.dataset.codexQuotaFooter = "";
        anchor.style.display = "inline-flex";
        anchor.style.alignItems = "center";
        anchors.set(origin, anchor);
      }
      if (changed) context.before(anchor);
      if (changed || force) notify(origin, anchor);
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
