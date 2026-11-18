---
type: Marketplace Submission
description: Submitted pull request for Codex Quota 0.1.0, including installation, privacy and validation results.
created: "2026-11-17"
---
# Codex Quota 0.1.0

[BB Marketplace submission #994](https://github.com/get-bb/marketplace/pull/994)

Codex Quota shows the smallest remaining Codex limit beside the BB context meter. On a phone, the ring sits beside the send controls. The card shows each quota window, its reset time and any available manual resets.

**Try it.** In a Codex thread, hover over or tap the ring. When resets are available, tap the lightning bolt to see their expiry dates. Tap again to close the list. Viewing dates never spends a reset.

**Release.** [Codex Quota v0.1.0](https://github.com/ai-babai/bb-plugin-codex-quota/tree/v0.1.0), MIT, package `bb-plugin-codex-quota`, entry ID `codex-quota`. The public tag resolves to `fe246a982be96bf5a77106d4bc303c5c598d7d4b`. The registry tracks compatible releases with `^0.1.0`.

```sh
bb plugin install 'git:https://github.com/ai-babai/bb-plugin-codex-quota.git@^0.1.0'
```

**Requirements and data.** Requires BB 0.49+, Plugin SDK 0.6.132+ within 0.x, the bundled Codex provider and a Codex CLI signed in to a ChatGPT subscription on the thread’s machine. The provider supplies usage and may contact its service during refresh. For manual resets, the host reads `account/rateLimits/read` through Codex CLI. It checks the account match before returning the count or requested dates. The plugin reads no credentials and sends no telemetry. The content script places the ring and removes its anchors on cleanup.

**Listing assets.** The two screenshots show the installed Plus interface with demo quotas, in English (dark) and Russian (light). The overview matches the release’s [PLUGIN_OVERVIEW.md](https://github.com/ai-babai/bb-plugin-codex-quota/blob/v0.1.0/PLUGIN_OVERVIEW.md).

**Validation**

- The [release quality check](https://github.com/ai-babai/bb-plugin-codex-quota/actions/runs/44353378297) passed type checking, 78 plugin tests, 5 quality-tool tests, the BB build and package validation. The [mutation check](https://github.com/ai-babai/bb-plugin-codex-quota/actions/runs/44353378103) detected all 41 mutations in the quota timing logic.
- A clean BB 0.49.0 installation resolved the public Git range to `v0.1.0`, built the app, host and server with SDK 0.6.132, and reported the plugin as running.
- Marketplace built both catalogs with 627 entries. All remote source checks, 47 registry tests, the upload retry tests and the v1 compatibility gate passed.
