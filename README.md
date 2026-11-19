# Codex Quota for BB

[Русский](README.ru.md)

See how much of your OpenAI Codex subscription quota is left and when each limit resets. Select Codex and a machine to see your quota before sending the first message. In a BB thread, hover over or tap the teal ring beside the context meter. In the compact phone layout, the ring sits beside the send controls.

**Pro in a BB chat.** In this example, 65% of the weekly quota remains and two manual resets are available.

<img src="docs/screenshots/pro-weekly-en.png" width="752" alt="Codex Pro card above the teal quota ring beside the context meter, showing 65% left, 2 days and 8 hours until reset, and two available manual resets">

<details>
<summary>Compare with Plus — five-hour and weekly limits</summary>

<img src="marketplace/screenshots/codex-quota/footer-dark.png" width="480" alt="Codex Plus example in BB: 78% of the five-hour quota and 46% of the weekly quota remaining">

With 78% of the five-hour quota and 46% of the weekly quota left, the ring shows the lower value: **46%**.

</details>

The lightning bolt at the top right of the card shows how many manual resets are available, including zero. Hover over the bolt or tap it to see when your resets expire. Viewing them never uses a reset. If Codex cannot report the count, the icon stays hidden.

A **?** means usage is missing, at least 90 minutes old, or due for a new reading after a reset.

Click the ring to close the card after hovering. Click again to reopen it. Tap the ring or press **Enter** or **Space** with the ring focused to open or close the card. **Esc** closes it. By default, usage updates every two minutes while the page is visible. Hover over or press the ring to request a fresh reading immediately.

## Installation

Requires BB 0.49+, Plugin SDK 0.6.132 or newer in the 0.x series and BB’s bundled Codex provider. On the machine running the thread, Codex CLI must be signed in with a ChatGPT plan that includes Codex.

Install the released plugin from Git

```sh
bb plugin install 'git:https://github.com/ai-babai/bb-plugin-codex-quota.git@^0.1.0'
```

Update an existing Git installation with `bb plugin update codex-quota`.

<details>
<summary>Local checkout</summary>

To install from a local checkout instead, run these commands in the repository root.

```sh
npm ci --omit=dev --ignore-scripts
bb plugin install .
```

</details>

## Quick settings

Open the quota card and select the gear to change the refresh interval or choose where the ring appears. The chat and left sidebar can be toggled independently. A Codex side chat uses its own quota even when the main chat uses another provider. If you hide both rings, turn either one back on in **BB Settings → Installed plugins → Codex Quota**.

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

[Quality checks](docs/QUALITY.md) · [Project map](INDEX.md) · [MIT license](LICENSE)
