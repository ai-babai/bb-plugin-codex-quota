// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { mountUsageFooter } from "../lib/usage-footer";

const anchorSelector = "[data-codex-quota-footer]";

function makeComposer({ compact = false, showQuota = true }: { compact?: boolean; showQuota?: boolean } = {}) {
  const shell = document.createElement("div");
  shell.dataset.appComposerRole = "primary";
  shell.dataset.promptboxShell = "";
  shell.innerHTML = `
    <div>${showQuota ? '<span data-codex-quota-origin></span>' : ''}</div>
    <div data-follow-up-composer-anchor>
      <div data-follow-up-composer>
        <div data-composer-box>
          <form data-promptbox ${compact ? 'data-promptbox-compact' : ''}>
            <div data-promptbox-action-row><div data-promptbox-submit-group></div></div>
          </form>
        </div>
        <div data-follow-up-composer-footer>
          <button aria-label="Permission mode"></button>
          <button aria-label="Context window"></button>
        </div>
      </div>
    </div>`;
  const footer = shell.querySelector("[data-follow-up-composer-footer]")!;
  const context = footer.lastElementChild!;
  if (compact) footer.remove();
  return {
    shell, footer, context,
    form: shell.querySelector("form")!,
    submitGroup: shell.querySelector("[data-promptbox-submit-group]")!,
    origin: shell.querySelector("[data-codex-quota-origin]"),
  };
}

function mountFooter() {
  return mountUsageFooter({ pluginId: "codex-quota", generation: 1, signal: new AbortController().signal });
}

function requestPlacement() {
  document.dispatchEvent(new Event("codex-quota:place-footer"));
}

it("follows the context control across footer changes and cleans up on disposal", () => {
  const { shell, origin, footer, context, submitGroup } = makeComposer();
  document.body.append(shell);
  const onPlaced = vi.fn();
  const dispose = mountFooter();
  document.addEventListener("codex-quota:footer-placed", onPlaced);
  try {
    const anchor = context.previousElementSibling;
    expect(anchor?.matches(anchorSelector)).toBe(true);
    requestPlacement();
    expect(onPlaced).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { origin, target: anchor } }));

    context.remove();
    requestPlacement();
    expect(footer.querySelector(anchorSelector)).toBeNull();
    expect(submitGroup.previousElementSibling).toBe(anchor);
    submitGroup.remove();
    requestPlacement();
    expect(onPlaced).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { origin, target: null } }));

    footer.append(context);
    requestPlacement();
    expect(context.previousElementSibling?.matches(anchorSelector)).toBe(true);
    dispose();
    expect(footer.querySelector(anchorSelector)).toBeNull();
    requestPlacement();
    expect(footer.querySelector(anchorSelector)).toBeNull();
  } finally {
    document.removeEventListener("codex-quota:footer-placed", onPlaced);
    dispose();
    shell.remove();
  }
});

it("uses the local send controls until context appears, follows it, and removes the orphaned anchor", async () => {
  const layout = document.createElement("div");
  const { shell, footer, context, origin, submitGroup } = makeComposer();
  const other = makeComposer({ showQuota: false });
  context.remove();
  context.removeAttribute("aria-label");
  context.setAttribute("title", "Context window");
  layout.append(other.shell, shell);
  document.body.append(layout);
  const dispose = mountFooter();
  try {
    expect(submitGroup.previousElementSibling?.matches(anchorSelector)).toBe(true);

    footer.append(context);
    const anchor = await vi.waitFor(() => {
      const anchor = context.previousElementSibling;
      expect(anchor?.matches(anchorSelector)).toBe(true);
      return anchor!;
    });

    footer.prepend(context);
    await vi.waitFor(() => expect(context.previousElementSibling).toBe(anchor));

    origin!.remove();
    await vi.waitFor(() => expect(layout.querySelector(anchorSelector)).toBeNull());
    expect(context.isConnected).toBe(true);
  } finally {
    dispose();
    layout.remove();
  }
});

it("moves one anchor between the compact submit group and the same composer's context control", async () => {
  const layout = document.createElement("div");
  const { shell, footer, context, form, submitGroup } = makeComposer({ compact: true });
  const other = makeComposer();
  layout.append(shell, other.shell);
  document.body.append(layout);
  const dispose = mountFooter();
  try {
    const anchor = submitGroup.previousElementSibling;
    const otherAnchor = other.context.previousElementSibling;
    expect(anchor?.matches(anchorSelector)).toBe(true);
    expect(otherAnchor?.matches(anchorSelector)).toBe(true);
    expect(anchor).not.toBe(otherAnchor);

    form.removeAttribute("data-promptbox-compact");
    shell.querySelector("[data-follow-up-composer]")!.append(footer);
    await vi.waitFor(() => expect(context.previousElementSibling).toBe(anchor));

    footer.remove();
    form.setAttribute("data-promptbox-compact", "");
    await vi.waitFor(() => expect(submitGroup.previousElementSibling).toBe(anchor));
    expect(other.context.previousElementSibling).toBe(otherAnchor);
    expect(shell.querySelectorAll(anchorSelector)).toHaveLength(1);
    expect(other.shell.querySelectorAll(anchorSelector)).toHaveLength(1);
  } finally {
    dispose();
    layout.remove();
  }
});

it("does not place the quota beside an unrelated context control elsewhere on the page", () => {
  const composer = document.createElement("div");
  composer.innerHTML = '<span data-codex-quota-origin></span>';
  const otherContext = document.createElement("button");
  otherContext.title = "Context window";
  document.body.append(composer, otherContext);
  const dispose = mountFooter();
  try {
    expect(document.body.querySelector(anchorSelector)).toBeNull();
  } finally {
    dispose();
    composer.remove();
    otherContext.remove();
  }
});
