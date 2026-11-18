---
type: Submission Draft
description: Pull request draft for listing Codex Quota in BB Community, with local validation results and the required public tag check.
created: "2026-11-17"
---
Codex Quota puts a teal subscription-quota ring next to the permission control
and context meter in Codex threads. A compact popover shows each reported
window's remaining percentage and reset countdown.

The proposed source is [ai-babai/bb-plugin-codex-quota](https://github.com/ai-babai/bb-plugin-codex-quota)
with Git range `^0.1.0` and initial tag `v0.1.0`. The package is
`bb-plugin-codex-quota@0.1.0`. The entry ID is `codex-quota` and the submitter
is the `ai-babai` GitHub account.

The plugin runs with BB's plugin trust and reads the bundled Codex provider's
public usage RPC for the thread's execution machine. Manual refresh may cause
that provider to contact its usage service. The plugin leaves credential
handling to the provider and excludes account keys, email addresses and
provider error bodies from its browser response. It requires BB 0.49+ with
Plugin SDK 0.6.132+ in the 0.x series, the bundled Codex provider, and Codex CLI
signed in to a ChatGPT subscription. Footer placement uses a content script
that removes its anchors on cleanup.

Both screenshots show the installed plugin in BB with demo usage data.

- `footer-dark.png` shows the English popover and quota ring in the dark theme.
- `quota-light.png` shows the Russian popover and quota ring in the light theme.

The overview is copied byte for byte from the plugin repository's
`PLUGIN_OVERVIEW.md`.

Local plugin validation passed with `npm run check`, including TypeScript,
21 tests, the BB build and the package dry-run check. Marketplace validation
passed with `npm run build`, `npm test` (47 tests and a mocked retry check),
and `npm run gate:v1`. The v1 gate found one new entry.

Public source validation is pending. The GitHub repository is private and
has no release tags. Before opening the PR, verify that the public `v0.1.0`
tag resolves to the approved plugin commit and rerun marketplace
`npm run check` against the source in the entry.
