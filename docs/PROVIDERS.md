---
type: Integration Guide
description: Register a host-scoped quota collector and report custom quota windows.
created: "2026-11-19"
---
# Add a quota collector

In [lib/quota-adapters.ts](../lib/quota-adapters.ts), add this example before
the `quotaAdapters` array. Replace `example-agent` with an additional provider
ID you can select in BB and `your-bb-host-id` with the ID of its execution host.

```ts
const demoUsageByHost = new Map([["your-bb-host-id", 62.5]]);

const exampleQuota: QuotaAdapter = {
  id: "example-agent",
  label: "Example Agent",
  create: () => ({
    async readQuota({ hostId }) {
      const remaining = demoUsageByHost.get(hostId);
      if (remaining === undefined) return { account: null, error: "unavailable" };
      return {
        error: null,
        account: {
          plan: "Demo",
          observedAt: Date.now(),
          windows: [{
            id: "six-hour",
            kind: "custom",
            label: "6 hours",
            remaining,
            resetsAt: null,
          }],
        },
      };
    },
  }),
};
```

Add `exampleQuota` to `quotaAdapters`. The chat and sidebar get its label
and capabilities through `listProviders`. With your local checkout installed,
run `npm run build && bb plugin reload codex-quota` and open a chat for that
provider on the configured host. If you move the collector into a separate
file, include its path in `package.json` under `files` for npm rebuilds.

- Read usage for the supplied `hostId`, which is the chat’s execution machine.
  The collector also receives `refresh` and an abort `signal` for I/O.
- Set `observedAt` to the time the source was read in Unix milliseconds.
  Report `remaining` as a percentage from 0 to 100, so `62.5` means 62.5%
  left. Use a stable `id` and a display `label` for each custom window.
  Keep credentials, account identifiers and raw provider errors out of the
  result.
- Set `resetsAt` to an ISO 8601 timestamp with a time zone or `null` if it is
  unknown. Manual resets are a separate capability. Omit
  `readAvailableResets` to hide the manual reset control. If you implement it,
  report credit `expiries` in Unix seconds, with `null` for a credit that
  never expires.

## Source keys

`resolveSource(location)` returns `{ sourceKey }`. The browser can pass the key
as `expectedSourceKey` to `quota` and `availableResets`. A source change or an
unconfirmed identity yields unavailable quota or a null reset count. Existing
calls may omit the key and keep their original behavior. A key is opaque and
valid for the lifetime of the plugin's server instance.

The example above has one fixed source per scope. It receives a default key
scoped to the provider, host, and any resolved environment and thread. For an
account or resource that can change within a scope, implement `resolveSource`
and return the server-only `{ resourceId, accountKey }` pair, or `null` when it
cannot be confirmed. Include `source` with that pair in `readQuota`, derived
from the same observation as the quota. Guarded `readAvailableResets` receives
the resolved `source` to read. Verify it against the reset result and include
the observed `source` with the result. The RPC layer keeps both identities
server-side and exposes only the opaque key.
