---
type: Marketplace Submission
description: Review notes for Codex Quota 0.2.0 in BB Community marketplace pull request 994.
created: "2026-11-17"
---
# Codex Quota 0.2.0

[Marketplace submission #994](https://github.com/get-bb/marketplace/pull/994)

Codex Quota shows the remaining OpenAI Codex quota and the next reset in BB. In 0.2.0 the ring appears before the first message, in Codex side chats and above Settings in the left sidebar. The gear opens the refresh interval and placement controls.

**Try it.** Select Codex and a machine. Hover over or tap the ring. A side chat uses its own machine’s quota even when the main chat uses another provider. Tap the lightning bolt to inspect manual reset expiry dates. Open the gear to change the interval or hide one ring.

**Source.** [v0.2.0](https://github.com/ai-babai/bb-plugin-codex-quota/tree/v0.2.0), range `^0.2.0`, package `bb-plugin-codex-quota`, entry `codex-quota`, MIT.

```sh
bb plugin install 'git:https://github.com/ai-babai/bb-plugin-codex-quota.git@^0.2.0'
```

**Access.** Requires BB 0.49+, a compatible 0.x Plugin SDK from 0.6.132, BB’s bundled Codex provider and Codex CLI signed in on the chat’s machine. Usage comes from the provider. The host uses the CLI’s read-only rate-limit request and verifies the account match before returning a reset count or expiry dates. Viewing a date never spends a reset. The plugin sends no telemetry.

**Listing.** The English dark and Russian light screenshots show the Plus quota card in chat and the Pro sidebar card alongside quick settings. The percentages, dates and three manual resets are demo data. The overview comes from the plugin’s [PLUGIN_OVERVIEW.md](https://github.com/ai-babai/bb-plugin-codex-quota/blob/v0.2.0/PLUGIN_OVERVIEW.md).

**Release checks.** [Quality on v0.2.0](https://github.com/ai-babai/bb-plugin-codex-quota/actions/runs/44545451533) passed 115 plugin tests, five quality-tool tests, TypeScript, all three BB builds and package validation. [Mutation testing](https://github.com/ai-babai/bb-plugin-codex-quota/actions/runs/44545451709) caught all 41 mutations in the quota timing code. The public tag resolves to `5f69249c68b87063cbdb557da30d8a8391ec77db`.

**Catalog checks.** Both catalog formats built with 627 entries. The 47 registry tests, retry tests and v1 compatibility gate passed. The seven submitted listing files match the tagged plugin repository byte for byte.

**Public install and upgrade.** A clean BB 0.50.1 instance installed the public `^0.2.0` source, selected the release commit above and reported `running`. A second instance upgraded from `^0.1.0` with `bb plugin update codex-quota --range '^0.2.0'`. The language and custom refresh interval persisted.

The full registry `npm run check` passed, including remote-source checks for all 627 entries. The [release verification record](https://github.com/ai-babai/bb-plugin-codex-quota/releases/download/v0.2.0/verification-v0.2.0.json) includes the install and upgrade results, workflow links and screenshot hashes.
