// @vitest-environment jsdom
import { expect, it } from "vitest";
import { mountUsageFooter } from "../lib/usage-footer";

it("follows the context control across footer changes and cleans up on disposal", () => {
  const footer = document.createElement("div");
  footer.innerHTML = '<span data-codex-quota-origin></span><button aria-label="Permission mode"></button><button aria-label="Context window"></button>';
  document.body.append(footer);
  const context = footer.lastElementChild!;
  const selector = "[data-codex-quota-footer]";
  const dispose = mountUsageFooter({ pluginId: "codex-quota" } as Parameters<typeof mountUsageFooter>[0]);
  try {
    expect(context.previousElementSibling?.matches(selector)).toBe(true);
    context.remove();
    document.dispatchEvent(new Event("codex-quota:place-footer"));
    expect(footer.querySelector(selector)).toBeNull();
    footer.append(context);
    document.dispatchEvent(new Event("codex-quota:place-footer"));
    expect(context.previousElementSibling?.matches(selector)).toBe(true);
    dispose();
    expect(footer.querySelector(selector)).toBeNull();
    document.dispatchEvent(new Event("codex-quota:place-footer"));
    expect(footer.querySelector(selector)).toBeNull();
  } finally {
    dispose();
    footer.remove();
  }
});
