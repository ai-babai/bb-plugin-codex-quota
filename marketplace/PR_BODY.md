---
type: Submission Draft
description: Pull request draft for listing Codex Quota in BB Community, with local validation results and the required public tag check.
created: "2026-11-17"
---
Codex Quota puts a teal subscription-quota ring next to the permission control
and context meter in Codex threads. A compact popover shows each reported
window's remaining percentage and reset countdown, plus the available manual
resets when Codex reports them. The refresh interval, hover and press triggers,
and display language are configurable.

The public source is [ai-babai/bb-plugin-codex-quota](https://github.com/ai-babai/bb-plugin-codex-quota)
with Git range `^0.1.0` and planned initial tag `v0.1.0`. The package is
`bb-plugin-codex-quota@0.1.0`. The entry ID is `codex-quota` and the submitter
is the `ai-babai` GitHub account.

The plugin runs with BB's plugin trust and reads the bundled Codex provider's
public usage RPC for the thread's execution machine. Refresh requests may
cause the provider to contact its usage service. Defaults are a two-minute
poll while the thread is visible and refresh on hover or press. A host entry
runs Codex CLI's app-server on the thread's machine and calls the read-only
`account/rateLimits/read` method for the manual reset count. The host verifies
the account and returns only the count and requested expiry dates. Codex
handles credentials. The plugin excludes account keys, email addresses and
provider error bodies from its browser response. It requires BB 0.49+ with
Plugin SDK 0.6.132+ in the 0.x series, the bundled Codex provider, and Codex CLI
signed in to a ChatGPT subscription. Footer placement uses a content script
that removes its anchors on cleanup.

Both screenshots show the installed plugin in BB with demo usage data for
Codex Plus, including five-hour and weekly windows and the reset counter.

- `footer-dark.png` shows the English popover and quota ring in the dark theme.
- `quota-light.png` shows the Russian popover and quota ring in the light theme.

The overview is copied byte for byte from the plugin repository's
`PLUGIN_OVERVIEW.md`.

The plugin passed TypeScript, all 32 behavioral tests, the BB build and package
validation. A clean production-only installation also built successfully.

Marketplace validation passed on upstream `c134869e56ebe40fa0280314508d6de3fbe8368e`
with `npm run build` (627 entries in each catalog), `npm test` (47 tests and a
mocked retry check), and `npm run gate:v1` (one new entry).

An anonymous Git lookup can read the public repository. Source liveness for
this entry is blocked until the repository has a release tag for `^0.1.0`.
Before opening the PR, confirm plugin `npm run check` for the approved source
commit, verify that the public `v0.1.0` tag resolves to that commit, and rerun
marketplace `npm run check` against the source in the entry.
