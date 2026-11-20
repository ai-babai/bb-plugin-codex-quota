---
type: Project Index
description: Find user documentation, runtime entry points and release materials for the Codex Quota plugin.
created: "2026-11-17"
---
# Codex Quota

## User documentation

- [English README](README.md) — primary GitHub README with installation, usage, privacy and development instructions.
- [Русский README](README.ru.md) — те же инструкции на русском языке.

The GitHub READMEs begin with their visible heading because GitHub displays YAML front matter as a metadata table. Maintenance documents use YAML front matter.

## Runtime

- [app.tsx](app.tsx) and [sidebar-quota.tsx](lib/sidebar-quota.tsx) select the chat or sidebar context and render the same quota card.
- [use-quota.ts](lib/use-quota.ts) connects each ring to the [quota store](lib/quota-store.ts). Rings subscribed to the same source share quota readings, refreshes and the polling timer.
- [server.ts](server.ts) resolves a context to its quota source and routes requests to a [registered collector](lib/quota-adapters.ts). The [Codex collector](lib/codex-adapter.ts) reads usage from BB’s Codex provider.
- [host.ts](host.ts) — read the count and expiry dates of available manual resets from Codex CLI on the thread’s machine.
- [lib/usage-footer.ts](lib/usage-footer.ts) — footer placement and cleanup.
- [lib/quota-popover.tsx](lib/quota-popover.tsx) — hover, click and keyboard behavior.

## Development

- [Quota collectors](docs/PROVIDERS.md) — register a provider and report host-scoped quota windows.

## Release materials

- [Release guide](docs/RELEASE.md) — validation, publication and approval requirements.
- [Store overview](PLUGIN_OVERVIEW.md) — long-form marketplace description.
- [Marketplace entry](marketplace/entries/codex-quota.json) — prepared catalog entry.
- [README screenshots](docs/screenshots/) — Pro, sidebar settings and manual reset dates in English and Russian.
- [Gallery images](marketplace/screenshots/codex-quota/) — the marketplace entry selects the English chat, sidebar and phone views. The Russian README uses localized images.
