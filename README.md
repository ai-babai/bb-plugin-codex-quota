# Codex Quota for BB

[Русский](README.ru.md)

See how much of your OpenAI Codex subscription quota is left and when each limit resets. Hover over the teal ring beside the context meter in a BB thread.

**Pro example.** Codex reports one weekly limit. The card shows how much is left and when it resets.

<img src="docs/screenshots/pro-weekly-en.png" width="480" alt="Codex Pro in BB: 65% of the weekly quota remains, with 2 days and 8 hours until reset">

<details>
<summary>Compare with Plus — five-hour and weekly limits</summary>

<img src="marketplace/screenshots/codex-quota/footer-dark.png" width="480" alt="Codex Plus example in BB: 78% of the five-hour quota and 46% of the weekly quota remaining">

With 78% of the five-hour quota and 46% of the weekly quota left, the ring shows the lower value: **46%**.

</details>

The lightning bolt at the top right of the card shows how many manual resets are available, including zero. Hover over the bolt to see expiry dates. Viewing them never uses a reset. If Codex cannot report the count, the icon stays hidden.

A **?** means usage is missing, at least 90 minutes old, or due for a new reading after a reset.

Click the ring to close the card after hovering. Click again to reopen it. Tap the ring or press **Enter** or **Space** with the ring focused to open or close the card. **Esc** closes it. By default, usage updates every two minutes while the page is visible. Hover over or press the ring to request a fresh reading immediately.

## Installation

Requires BB 0.49+, Plugin SDK 0.6.132 or newer in the 0.x series and BB’s bundled Codex provider. On the machine running the thread, Codex CLI must be signed in with a ChatGPT plan that includes Codex.

From a local checkout with npm and the BB CLI:

```sh
npm ci --omit=dev --ignore-scripts
bb plugin install .
```

After the first public tag (`v0.1.0`), installation and updates are available through Git:

```sh
bb plugin install 'git:https://github.com/ai-babai/bb-plugin-codex-quota.git@^0.1.0'
bb plugin update codex-quota
```

## Language

English is the default. Choose **English** or **Русский** in **Codex Quota settings → Language**. An agent can set the same preference from the CLI:

```sh
bb plugin config codex-quota set language ru
```

## Refresh settings

Set the interval in seconds. For example, this checks usage every five minutes:

```sh
bb plugin config codex-quota set refreshIntervalSeconds 300
```

The default is 120. Set it to `0` to disable the timer. `refreshOnHover` and `refreshOnPress` each accept `true` (default) or `false`. These settings also appear in BB’s plugin configuration.

## Privacy

Quota windows come from BB’s Codex provider. When a Codex thread loads or its usage updates, the plugin asks Codex CLI on the thread’s machine for the reset count using `account/rateLimits/read`. Only the count and requested expiry dates reach the UI after the accounts match. Codex handles sign-in. The plugin sends no telemetry.

## Development

With Node.js 22.13+ (22.x) or 24+, npm and the BB CLI:

```sh
npm ci --ignore-scripts
npm run check
```

[Project map](INDEX.md) · [MIT license](LICENSE)
