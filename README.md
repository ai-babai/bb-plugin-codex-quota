# Codex Quota for BB

[Русский](README.ru.md)

Codex Quota shows how much of your OpenAI Codex subscription quota is left and when each limit resets. Select Codex and an existing machine in a new BB chat to check your limits before sending the first message.

> This branch previews a redesigned quota card and quick settings. The stable release is [v0.2.1](https://github.com/ai-babai/bb-plugin-codex-quota/tree/v0.2.1#readme).

<img src="docs/screenshots/pro-weekly-en.png" width="752" alt="Codex Pro card in a BB chat. It shows the weekly quota, its reset countdown, and a lightning bolt with three manual resets">

<details>
<summary>Compare with Plus — five-hour and weekly limits</summary>

In this example, 78% of the five-hour quota and 46% of the weekly quota remain. The ring shows the lower value, **46%**.

<img src="marketplace/screenshots/codex-quota/footer-dark.png" width="752" alt="Codex Plus quota card in a BB chat with five-hour and weekly limits and their reset countdowns">

</details>

## Where to see your Codex limits

The teal ring sits beside the context meter in Codex chats and side chats, and above Settings in the left sidebar. A Codex side chat shows the quota for its machine even when the main chat uses another provider.

Hover over the ring to preview each reported limit. The large number is what is left, and every limit uses the same bar. The vertical mark shows how much of the window’s time is left. When the fill extends past it, a larger share of the quota remains than of the time. Below the bar are the countdown and the reset time.

Click the ring to close the preview, then click again to reopen it. With the ring focused, use **Enter** or **Space** to toggle it and **Esc** to close it. While the first reading is loading, the ring shows a spinner. A **?** means quota data is missing, at least 90 minutes old, or awaiting an update after a reset.

The lightning bolt shows the number of available manual resets, including zero. It stays hidden when the count is unknown. If resets are available, hover over or tap the bolt to check their expiry dates without using a reset.

<details>
<summary>Manual reset expiry dates</summary>

<img src="docs/screenshots/resets-en.png" width="363" alt="Resets tooltip above the lightning bolt in a Codex quota card, listing the expiry date and time of each available manual reset">

</details>

## On your phone

Tap the teal ring in the chat composer or open the left sidebar and tap the ring above Settings. Both show the remaining quota and reset time.

<img src="marketplace/screenshots/codex-quota/mobile-en.png" width="640" alt="Mobile BB with the quota ring in the chat composer and the Codex Pro card open in the left sidebar">

## Quick settings

The **Settings** gear beside the plan name opens **Refresh every** and the **Show ring** switches **In chat** and **In sidebar**. **Save** appears once you change something.

<img src="docs/screenshots/sidebar-en.png" width="600" alt="Left sidebar in BB with the Codex Pro quota card on the left and its refresh and placement settings on the right">

The chat and sidebar rings share one reading for the same account on the same machine. Opening a Codex chat checks its quota automatically, even with the timer off. By default, quota refreshes every two minutes while the page is visible. Hover over or press either ring to update both. In **Settings → Installed plugins → Codex Quota**, you can restore either ring, change those refresh triggers, or set **Language** to **English** (default) or **Русский**.

<details>
<summary>Language and refresh interval from the CLI</summary>

```sh
bb plugin config codex-quota set language ru
bb plugin config codex-quota set refreshIntervalSeconds 300
```

Use `en` for English. The interval is in seconds, so `300` checks every five minutes and `0` turns off the timer. Set `refreshOnHover` or `refreshOnPress` to `false` to turn off that trigger.

</details>

## Installation

Requires BB 0.49+, Plugin SDK 0.6.132 or later in the 0.x series, and BB’s built-in Codex provider. On the machine running the chat, sign in to Codex CLI with a ChatGPT plan that includes Codex.

```sh
bb plugin install 'git:https://github.com/ai-babai/bb-plugin-codex-quota.git@^0.2.0'
```

For an existing 0.1.x installation, switch its tracked range to 0.2.x. BB keeps the plugin settings.

```sh
bb plugin update codex-quota --range '^0.2.0'
```

<details>
<summary>Install from a local checkout</summary>

Run these commands in the repository root.

```sh
npm ci --omit=dev --ignore-scripts
bb plugin install .
```

</details>

## Privacy

BB’s Codex provider supplies quota data. On load and refresh, the plugin reads the manual reset count from Codex CLI on the chat’s machine via `account/rateLimits/read`. After matching the accounts, the plugin sends the count and, when requested, expiry dates to the UI. Codex handles sign-in. The plugin sends no telemetry.

<details>
<summary>Development checks</summary>

Run with Node.js 22.13+ (22.x) or 24+, npm and the BB CLI.

```sh
npm ci --ignore-scripts
npm run check
```

</details>

[Add a quota collector](docs/PROVIDERS.md) · [Quality checks](docs/QUALITY.md) · [Project map](INDEX.md) · [MIT license](LICENSE)
