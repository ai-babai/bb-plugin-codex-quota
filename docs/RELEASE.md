---
type: Release Guide
description: How to verify Codex Quota, publish a Git release and submit the bilingual plugin to the BB Community marketplace.
created: "2026-11-17"
---
# Releasing Codex Quota

BB installs this plugin from GitHub. The BB Community repository hosts the
listing and its images. A maintainer reviews the submission, and a merge to
`main` triggers catalog publication.

| Release field | Value |
| --- | --- |
| GitHub owner | `ai-babai` |
| Plugin repository | [ai-babai/bb-plugin-codex-quota](https://github.com/ai-babai/bb-plugin-codex-quota) |
| Package and BB ID | `bb-plugin-codex-quota` · `codex-quota` |
| Current release | `v0.2.0` |
| Marketplace tracking range | `^0.2.0` |
| Primary category | `token-usage-and-limits` |

## 1. Verify the plugin

Run the following in a clean checkout with the BB CLI installed:

```sh
npm ci --ignore-scripts
npm run check
git diff --check
```

The project check typechecks the source and tests, runs behavioral tests,
builds the BB bundles and verifies the npm archive contents. For a Git release,
also build the checkout with only production dependencies installed. Check the
ring in a Codex thread in light and dark themes, including hover, keyboard
dismissal, ring activation to refresh and the saved language.

## 2. Publish the approved source

For the first release, show the owner the commit SHA, repository, visibility,
version, tag and proposed remote operations. Obtain approval for the exact
release before the first push, public visibility change or tag. The owner can
approve a private repository update separately.

The public Git source for the listing must resolve anonymously, and its
`v0.2.0` tag must point at the approved commit. Use an annotated tag and verify
the peeled commit. Replace `APPROVED_COMMIT` with the full reviewed SHA.

```sh
git tag -a v0.2.0 APPROVED_COMMIT -m 'Codex Quota 0.1.0'
git push origin refs/tags/v0.2.0
git ls-remote --tags https://github.com/ai-babai/bb-plugin-codex-quota.git 'refs/tags/v0.2.0*'
```

## 3. Validate the listing

Start from current `get-bb/marketplace:main`. Copy the submission files
from this repository’s `marketplace/` directory into the same relative paths
in the registry: the entry JSON, its SVG icon, the referenced PNGs and the Markdown
overview. The PR description is maintained separately in
[PR_BODY.md](../marketplace/PR_BODY.md). Keep the registry overview identical
to [PLUGIN_OVERVIEW.md](../PLUGIN_OVERVIEW.md).

The public Git URL, author account, category and filenames must match the
entry. The gallery shows chat, sidebar, quick settings and phone layouts in English and Russian.
The screenshots use illustrative data.
The registry accepts screenshots at least 1200 pixels wide and up to 2 MiB
each. Its Markdown overview supports HTTPS links and up to 4000 characters.

Run the registry checks from the submission checkout:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run gate:v1
npm run check
```

The final check resolves remote sources. For this plugin it requires a public
repository and a matching tag. Keep the real source in the submission during
validation.

## 4. Submit for review

After the public tag passes verification, finalize the PR description with
the approved source SHA and check results. Obtain approval for that exact
submission. Push the branch to the submitter’s fork. Update the existing pull request
when it is still open, or open a new one against `get-bb/marketplace:main`. After merge, verify `codex-quota`
in the [published catalog](https://getbb.app/marketplace/v2/marketplace.json).
Future compatible releases can use new Git tags within the same range.

### What helps a reviewer

- Lead with what appears in BB and how to try it. Include a short touch or keyboard check for an interactive plugin.
- Identify the released tag and tracking range. Test the exact public install command in a clean BB instance.
- Name the host process, the data it reads and what reaches the UI. Label demo data in the screenshots.
- Report plugin and registry checks separately. Keep the catalog patch limited to the listing and its assets.

Accepted examples include [Usage & Limits](https://github.com/get-bb/marketplace/pull/991), [Link Tooltips](https://github.com/get-bb/marketplace/pull/987) and [Thread PR Manager](https://github.com/get-bb/marketplace/pull/985).

[Marketplace submission rules](https://github.com/get-bb/marketplace#submit-a-plugin) ·
[Entry schema](https://github.com/get-bb/marketplace/blob/main/schema/marketplace-v2.schema.json) ·
[Validation workflow](https://github.com/get-bb/marketplace/blob/main/.github/workflows/validate.yml)
