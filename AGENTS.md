---
type: Agent Instructions
description: Entry point for maintaining Codex Quota. Read the project map and release requirements before changing or distributing the plugin.
created: "2026-11-17"
---
# Codex Quota

Start with [INDEX.md](INDEX.md), then [README.md](README.md).

Keep the plugin independent of CLI Relay and private infrastructure. Use only
public BB SDK and provider usage RPC surfaces. Do not read credentials or return
account identity or provider error bodies to the browser.

Preserve the footer placement beside the context meter, teal quota ring, compact
popover and left-to-right depletion of the bars. Treat a missing or stale quota
as unknown.

Follow [docs/RELEASE.md](docs/RELEASE.md) before publishing. Do not push, tag,
change repository visibility or submit a marketplace PR without owner approval
of the exact release. Do not add durable tests or snapshots without approval;
scratch checks are allowed. Marketplace screenshots are release assets.

`PLUGIN_OVERVIEW.md` and `marketplace/overview/` follow the marketplace's Markdown
contract rather than adding metadata to the text rendered in the store.
