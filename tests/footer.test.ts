// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { mountUsageFooter } from "../lib/usage-footer";

const anchorSelector = "[data-codex-quota-footer]";

function makeComposer({ compact = false, showQuota = true, role = "primary" }: {
  compact?: boolean; showQuota?: boolean; role?: "primary" | "secondary";
} = {}) {
  const shell = document.createElement("div");
  shell.dataset.appComposerRole = role;
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
    expect(footer.querySelector('button[aria-label="Permission mode"]')?.nextElementSibling).toBe(anchor);
    expect(submitGroup.previousElementSibling).toBeNull();
    footer.querySelector("button")!.remove();
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

it("uses the local permissions control until context appears, follows it, and removes the orphaned anchor", async () => {
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
    expect(footer.querySelector("button")?.nextElementSibling?.matches(anchorSelector)).toBe(true);
    expect(submitGroup.previousElementSibling).toBeNull();

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

it("places a Codex side chat's quota in its own footer when the main composer has no quota", () => {
  const main = makeComposer({ showQuota: false });
  const side = makeComposer({ role: "secondary" });
  const layout = document.createElement("div");
  layout.append(main.shell, side.shell);
  document.body.append(layout);
  const dispose = mountFooter();
  try {
    expect(side.context.previousElementSibling?.matches(anchorSelector)).toBe(true);
    expect(side.shell.querySelectorAll(anchorSelector)).toHaveLength(1);
    expect(main.shell.querySelector(anchorSelector)).toBeNull();
  } finally {
    dispose();
    layout.remove();
  }
});

it("keeps simultaneous main and side quotas local across layout changes, closure and reopening", async () => {
  const main = makeComposer();
  const side = makeComposer({ role: "secondary" });
  const compactSide = makeComposer({ role: "secondary", compact: true });
  const layout = document.createElement("div");
  layout.append(main.shell, side.shell, compactSide.shell);
  document.body.append(layout);
  const dispose = mountFooter();
  const onPlaced = vi.fn();
  document.addEventListener("codex-quota:footer-placed", onPlaced);
  try {
    const mainAnchor = main.context.previousElementSibling;
    const sideAnchor = side.context.previousElementSibling;
    const compactAnchor = compactSide.submitGroup.previousElementSibling;
    expect(layout.querySelectorAll(anchorSelector)).toHaveLength(3);
    expect(new Set([mainAnchor, sideAnchor, compactAnchor]).size).toBe(3);

    side.context.remove();
    await vi.waitFor(() => expect(side.footer.querySelector("button")?.nextElementSibling).toBe(sideAnchor));
    compactSide.form.removeAttribute("data-promptbox-compact");
    compactSide.shell.querySelector("[data-follow-up-composer]")!.append(compactSide.footer);
    await vi.waitFor(() => expect(compactSide.context.previousElementSibling).toBe(compactAnchor));

    side.shell.remove();
    await vi.waitFor(() => expect(sideAnchor?.isConnected).toBe(false));
    // The detached footer must lose the portal anchor too, not just leave it off screen.
    await vi.waitFor(() => expect(side.shell.querySelector(anchorSelector)).toBeNull());
    expect(main.context.previousElementSibling).toBe(mainAnchor);
    expect(compactSide.context.previousElementSibling).toBe(compactAnchor);

    layout.append(side.shell);
    await vi.waitFor(() => expect(side.shell.querySelectorAll(anchorSelector)).toHaveLength(1));
    const reopenedAnchor = side.shell.querySelector(anchorSelector);
    expect(reopenedAnchor).not.toBe(sideAnchor);
    requestPlacement();
    expect(onPlaced).toHaveBeenCalledWith(expect.objectContaining({ detail: { origin: side.origin, target: reopenedAnchor } }));
    expect(layout.querySelectorAll(anchorSelector)).toHaveLength(3);

    dispose();
    expect(layout.querySelector(anchorSelector)).toBeNull();
    onPlaced.mockClear();
    requestPlacement();
    main.footer.append(document.createElement("span"));
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(layout.querySelector(anchorSelector)).toBeNull();
    expect(onPlaced).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener("codex-quota:footer-placed", onPlaced);
    dispose();
    layout.remove();
  }
});
