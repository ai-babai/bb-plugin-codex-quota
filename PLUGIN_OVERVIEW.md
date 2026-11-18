## Quota beside your thread

A teal ring beside the permission control shows the smallest remaining
allowance across the limit windows your Codex provider reports.

Hover over the ring for each window's remaining percentage, reset date and
countdown in days, hours and minutes. Click or tap to keep the panel open. The
quota and countdown bars drain from left to right. The popover follows BB's
light and dark themes and supports keyboard navigation and Escape dismissal.
Select English or Русский in the plugin settings. English is the default.

## Data and refresh

The plugin reads quota from BB's bundled Codex provider on the machine running
the current thread. It checks usage every 2 minutes while the page is visible
and updates the countdown every 15 seconds. Select **Refresh** to request a
provider update. If quota is missing, outdated or waiting for a new report
after a reset, the ring shows a question mark.

The plugin reads quota values through BB's provider API. Credentials, account
keys, email addresses and provider error bodies stay out of the interface.

## Requirements

Use BB 0.49 or newer with Plugin SDK 0.6.132 or newer in the 0.x series and the
bundled Codex provider. Sign in to Codex CLI with your ChatGPT subscription on
the machine running the thread. Open a Codex thread with the footer context
meter visible.

[Source code and issues](https://github.com/ai-babai/bb-plugin-codex-quota)
