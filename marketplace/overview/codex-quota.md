## Reading the quota ring

Hover over the teal ring beside the context meter in a BB thread. The card shows each limit your Codex account reports and when it resets. If 78% of your five-hour quota and 46% of your weekly quota remain, the ring shows 46%.

Click the ring to close the card after hovering. Click again to reopen it. Tap the ring or press **Enter** or **Space** with the ring focused to open or close the card. **Esc** closes it. Usage updates every two minutes while the page is visible. **Refresh** requests a new reading. A question mark means the plugin is waiting for current data.

## Setup

Requires BB 0.49+, Plugin SDK 0.6.132 or later in the 0.x series, and BB’s bundled Codex provider. Sign in to Codex CLI on the machine running the thread with a ChatGPT plan that includes Codex. Choose English or Russian in the plugin settings.

The plugin reads usage from BB’s provider. It reads no credentials and sends no telemetry.

[Installation and source code](https://github.com/ai-babai/bb-plugin-codex-quota)
