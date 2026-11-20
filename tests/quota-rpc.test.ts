import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotaAdapter, QuotaCollector } from "../lib/quota-adapter";
import { quotaAdapters } from "../lib/quota-adapters";
import plugin, { createQuotaPlugin, type QuotaLocation } from "../server";

const threadId = "thread-1";
const environmentId = "environment-1";
const hostId = "host-execution";
const observedAt = 1_795_000_000_000;
const resetsAt = "2026-11-18T18:00:00.000Z";
const accountKey = "codex:test-account";
const accountEmail = "private@example.test";
const providerError = `Provider denied access for ${accountEmail}`;

const resource = {
  id: "execution-quota",
  providerId: "codex",
  scope: { kind: "host", hostId },
  accountKey,
};
const windows = [
  { id: "short", label: "5 hours", kind: "five-hour", usedPercent: 12.5, resetsAt },
  { id: "weekly", label: "Weekly", kind: "weekly", usedPercent: 125, resetsAt: null },
];

const unavailable = { account: null, error: "unavailable" };
const refreshFailed = { account: null, error: "refresh_failed" };
const codex = { id: "codex", label: "Codex", capabilities: { resets: true } };

const readHost = vi.fn();
const getThread = vi.fn();
const getEnvironment = vi.fn();
const listResources = vi.fn();
const getResource = vi.fn();
let host: ReturnType<typeof createFakePluginHost>;

beforeEach(() => {
  readHost.mockReset();
  getThread.mockReset().mockResolvedValue({ providerId: "codex", environmentId });
  getEnvironment.mockReset().mockResolvedValue({ hostId });
  listResources.mockReset().mockResolvedValue({ resources: [resource] });
  getResource.mockReset().mockResolvedValue({
    accountKey,
    observedAt,
    usage: { status: "ok", accountEmail, planLabel: "Pro", windows },
  });

  host = createFakePluginHost({
    pluginId: "codex-quota",
    experimental_callHostRpc: readHost,
    sdk: {
      threads: { get: getThread },
      environments: { get: getEnvironment },
      plugins: {
        async callRpc(args: Parameters<BbPluginApi["sdk"]["plugins"]["callRpc"]>[0]) {
          const { pluginId, method, input, outputSchema } = args;
          if (pluginId === "provider-codex") {
            if (method === "provider-usage.v1.listResources") return outputSchema.parse(await listResources(input));
            if (method === "provider-usage.v1.getResource") return outputSchema.parse(await getResource(input));
          }
          throw new Error(`Unexpected provider RPC: ${pluginId}/${method}`);
        },
      },
    },
  });
  plugin(host.bb);
});

afterEach(async () => {
  await host.harness.lifecycle.dispose();
});

async function sourceKey(location: QuotaLocation, pluginHost = host): Promise<string> {
  const result = await pluginHost.harness.behavior.callRpc("resolveSource", location) as { sourceKey: string | null };
  expect(result).toStrictEqual({ sourceKey: expect.any(String) });
  if (!result.sourceKey) throw new Error("Expected a source key");
  return result.sourceKey;
}

describe("quota source resolution", () => {
  it("returns the same opaque Codex key for thread, environment and host aliases", async () => {
    const key = await sourceKey({ threadId });

    expect(await sourceKey({ environmentId, providerId: "codex" })).toBe(key);
    expect(await sourceKey({ hostId })).toBe(key);
    for (const raw of [threadId, environmentId, hostId, accountKey, resource.id]) expect(key).not.toContain(raw);
    expect(getResource).not.toHaveBeenCalled();
    expect(readHost).not.toHaveBeenCalled();
  });

  it("uses the cached usage read to find an account when the inventory is cold", async () => {
    listResources.mockResolvedValueOnce({ resources: [{ ...resource, accountKey: null }] });
    const coldKey = await sourceKey({ hostId });

    expect(await sourceKey({ hostId })).toBe(coldKey);
    expect(getResource).toHaveBeenCalledExactlyOnceWith({ resourceId: resource.id, refresh: false });
    expect(readHost).not.toHaveBeenCalled();
  });

  it("returns no Codex source when the inventory and usage read cannot confirm an account", async () => {
    listResources.mockResolvedValue({ resources: [{ ...resource, accountKey: null }] });
    getResource.mockResolvedValue({ accountKey: null, observedAt, usage: { status: "ok", windows } });

    await expect(host.harness.behavior.callRpc("resolveSource", { hostId })).resolves.toStrictEqual({ sourceKey: null });
    expect(readHost).not.toHaveBeenCalled();
  });

  it("returns no source for an unsupported location, unmatched host or provider failure", async () => {
    await expect(host.harness.behavior.callRpc("resolveSource", { hostId, providerId: "other" }))
      .resolves.toStrictEqual({ sourceKey: null });
    await expect(host.harness.behavior.callRpc("resolveSource", { hostId: "other-host" }))
      .resolves.toStrictEqual({ sourceKey: null });
    listResources.mockRejectedValueOnce(new Error(providerError));
    await expect(host.harness.behavior.callRpc("resolveSource", { hostId })).resolves.toStrictEqual({ sourceKey: null });
    expect(getResource).not.toHaveBeenCalled();
  });

  it("isolates keys by account, resource and host", async () => {
    const secondHost = "other-host";
    const original = await sourceKey({ hostId });
    listResources.mockResolvedValueOnce({ resources: [{ ...resource, accountKey: "different-account" }] });
    expect(await sourceKey({ hostId })).not.toBe(original);
    listResources.mockResolvedValueOnce({ resources: [{ ...resource, id: "different-resource" }] });
    expect(await sourceKey({ hostId })).not.toBe(original);
    listResources.mockResolvedValueOnce({ resources: [{ ...resource, scope: { kind: "host", hostId: secondHost } }] });
    expect(await sourceKey({ hostId: secondHost })).not.toBe(original);
  });

  it.each(["changed-account", null, 123])("rejects quota when the observation has account %j and inventory still matches", async (observedAccount) => {
    const expectedSourceKey = await sourceKey({ threadId });
    getResource.mockResolvedValue({ accountKey: observedAccount, observedAt, usage: { status: "ok", windows } });

    await expect(host.harness.behavior.callRpc("quota", { threadId, expectedSourceKey, refresh: true }))
      .resolves.toStrictEqual(unavailable);
    expect(getResource).toHaveBeenCalledExactlyOnceWith({ resourceId: resource.id, refresh: true });
    expect(readHost).not.toHaveBeenCalled();
  });

  it("returns only the legacy quota payload for a confirmed source", async () => {
    const expectedSourceKey = await sourceKey({ hostId });
    const result = await host.harness.behavior.callRpc("quota", { threadId, expectedSourceKey });

    expect(result).toStrictEqual(await host.harness.behavior.callRpc("quota", { threadId }));
    expect(result).toMatchObject({ error: null });
    expect(Object.keys(result as object).sort()).toEqual(["account", "error"]);
  });
});

describe("quota RPC", () => {
  it("lists Codex and its resets capability without reading provider data", async () => {
    await expect(host.harness.behavior.callRpc("listProviders", {})).resolves.toStrictEqual({ providers: [codex] });
    expect(listResources).not.toHaveBeenCalled();
    expect(readHost).not.toHaveBeenCalled();
  });

  it("uses the thread's actual Codex host resource even if the request supplies other IDs", async () => {
    listResources.mockResolvedValue({
      resources: [
        { ...resource, id: "other-host", scope: { kind: "host", hostId: "host-other" } },
        { ...resource, id: "other-provider", providerId: "claude-code" },
        { ...resource, id: "shared", scope: { kind: "shared" } },
        resource,
      ],
    });

    await expect(host.harness.behavior.callRpc("quota", {
      threadId, hostId: "host-other", environmentId: "other-environment", providerId: "codex", refresh: true,
    }))
      .resolves.toMatchObject({ error: null });
    expect(getThread).toHaveBeenCalledExactlyOnceWith({ threadId });
    expect(getEnvironment).toHaveBeenCalledExactlyOnceWith({ environmentId });
    expect(listResources).toHaveBeenCalledExactlyOnceWith({});
    expect(getResource).toHaveBeenCalledExactlyOnceWith({ resourceId: resource.id, refresh: true });
  });

  it.each([{ hostId }, { environmentId }])("reads draft quota and resets on its selected machine (%j)", async location => {
    readHost.mockResolvedValue({ count: 2 });
    await expect(host.harness.behavior.callRpc("quota", location)).resolves.toMatchObject({ error: null });
    await expect(host.harness.behavior.callRpc("availableResets", location)).resolves.toEqual({ count: 2 });
    expect(getThread).not.toHaveBeenCalled();
    expect(getEnvironment).toHaveBeenCalledTimes("hostId" in location ? 0 : 2);
    expect(readHost.mock.calls[0][0]).toMatchObject({ hostId });
  });

  it("returns only public quota fields, converts usage to remaining, and defaults refresh to false", async () => {
    await expect(host.harness.behavior.callRpc("quota", { threadId })).resolves.toStrictEqual({
      account: {
        plan: "Pro",
        observedAt,
        windows: [
          { id: "short", label: "5 hours", kind: "five-hour", remaining: 87.5, resetsAt },
          { id: "weekly", label: "Weekly", kind: "weekly", remaining: 0, resetsAt: null },
        ],
      },
      error: null,
    });
    expect(getResource).toHaveBeenCalledExactlyOnceWith({ resourceId: resource.id, refresh: false });
  });

  it.each([null, 123])("returns legacy quota with unconfirmed identity %j and no plan label", async (accountKey) => {
    getResource.mockResolvedValue({
      accountKey,
      observedAt,
      usage: { status: "ok", accountEmail: null, planLabel: null, windows },
    });

    await expect(host.harness.behavior.callRpc("quota", { threadId })).resolves.toMatchObject({
      account: { plan: "Codex", observedAt, windows: [{ remaining: 87.5 }, { remaining: 0 }] },
      error: null,
    });
  });

  it.each([
    { providerId: "claude-code", environmentId },
    { providerId: "codex", environmentId: null },
  ])("returns unavailable for a thread outside a Codex environment (%j)", async (thread) => {
    getThread.mockResolvedValue(thread);

    await expect(host.harness.behavior.callRpc("quota", { threadId })).resolves.toStrictEqual(unavailable);
    expect(getEnvironment).not.toHaveBeenCalled();
    expect(listResources).not.toHaveBeenCalled();
    expect(getResource).not.toHaveBeenCalled();
  });

  it("does not replace the thread provider with the requested provider", async () => {
    getThread.mockResolvedValue({ providerId: "claude-code", environmentId });
    const location = { threadId, providerId: "codex" };

    await expect(host.harness.behavior.callRpc("quota", location)).resolves.toStrictEqual(unavailable);
    await expect(host.harness.behavior.callRpc("availableResets", location)).resolves.toStrictEqual({ count: null });
    expect(getEnvironment).not.toHaveBeenCalled();
    expect(listResources).not.toHaveBeenCalled();
    expect(readHost).not.toHaveBeenCalled();
  });

  it("does not fall back to Codex for a host request with an unregistered provider", async () => {
    const location = { hostId, providerId: "unregistered" };

    await expect(host.harness.behavior.callRpc("quota", location)).resolves.toStrictEqual(unavailable);
    await expect(host.harness.behavior.callRpc("availableResets", location)).resolves.toStrictEqual({ count: null });
    expect(listResources).not.toHaveBeenCalled();
    expect(readHost).not.toHaveBeenCalled();
  });

  it("does not read any provider data if the environment has no host", async () => {
    getEnvironment.mockResolvedValue({ hostId: null });

    await expect(host.harness.behavior.callRpc("quota", { environmentId })).resolves.toStrictEqual(unavailable);
    expect(listResources).not.toHaveBeenCalled();
  });

  it("does not collect usage when only another host has a resource", async () => {
    listResources.mockResolvedValue({
      resources: [{ ...resource, scope: { kind: "host", hostId: "host-other" } }],
    });

    await expect(host.harness.behavior.callRpc("quota", { threadId, refresh: true }))
      .resolves.toStrictEqual(unavailable);
    expect(getResource).not.toHaveBeenCalled();
  });

  it.each([
    { status: "unauthenticated" },
    { status: "error", message: providerError },
  ])("returns unavailable without account details or error bodies for $status", async (usage) => {
    getResource.mockResolvedValue({
      accountKey,
      observedAt,
      usage: { ...usage, accountEmail, planLabel: "Pro" },
    });

    await expect(host.harness.behavior.callRpc("quota", { threadId, refresh: true }))
      .resolves.toStrictEqual(unavailable);
    expect(getResource).toHaveBeenCalledOnce();
  });

  it.each([
    { case: "missing windows", observedAt, windows: undefined },
    { case: "empty windows", observedAt, windows: [] },
    { case: "no successful observation", observedAt: null, windows },
  ])("returns unavailable for an OK provider response with $case", async (observation) => {
    getResource.mockResolvedValue({
      accountKey,
      observedAt: observation.observedAt,
      usage: { status: "ok", accountEmail, planLabel: "Pro", windows: observation.windows },
    });

    await expect(host.harness.behavior.callRpc("quota", { threadId })).resolves.toStrictEqual(unavailable);
    expect(getResource).toHaveBeenCalledOnce();
  });

  it("returns a generic failure when the provider RPC rejects", async () => {
    getResource.mockRejectedValue(new Error(providerError));

    await expect(host.harness.behavior.callRpc("quota", { threadId, refresh: true }))
      .resolves.toStrictEqual(refreshFailed);
    expect(getResource).toHaveBeenCalledExactlyOnceWith({ resourceId: resource.id, refresh: true });
  });
});

describe("available manual resets", () => {
  it("rejects a stale source before invoking the Codex host worker", async () => {
    const expectedSourceKey = await sourceKey({ hostId });
    listResources.mockResolvedValue({ resources: [{ ...resource, accountKey: "changed-account" }] });

    await expect(host.harness.behavior.callRpc("availableResets", { environmentId, includeExpiries: true, expectedSourceKey }))
      .resolves.toStrictEqual({ count: null });
    expect(readHost).not.toHaveBeenCalled();
    expect(getResource).not.toHaveBeenCalled();
  });

  it("reads confirmed resets once on the selected host using the verified account", async () => {
    const expectedSourceKey = await sourceKey({ hostId });
    const summary = { count: 1, expiries: [1_800_000_000] };
    readHost.mockResolvedValue(summary);

    await expect(host.harness.behavior.callRpc("availableResets", { threadId, includeExpiries: true, expectedSourceKey }))
      .resolves.toStrictEqual(summary);
    expect(readHost).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      method: "availableResets", hostId, input: { accountKey, includeExpiries: true },
    }));
    expect(listResources).toHaveBeenCalledTimes(2);
    expect(getResource).not.toHaveBeenCalled();
  });

  it.each([0, 3])("returns only the available count (%i) from the thread host", async count => {
    readHost.mockResolvedValue({ count });
    await expect(host.harness.behavior.callRpc("availableResets", { threadId })).resolves.toEqual({ count });
    expect(readHost).toHaveBeenCalledWith(expect.objectContaining({
      method: "availableResets", hostId, input: { accountKey, includeExpiries: false },
    }));
  });

  it("requests expiration dates only when asked", async () => {
    const summary = { count: 2, expiries: [1_800_000_000, null] };
    readHost.mockResolvedValue(summary);
    await expect(host.harness.behavior.callRpc("availableResets", { threadId, includeExpiries: true })).resolves.toEqual(summary);
    expect(readHost).toHaveBeenCalledWith(expect.objectContaining({ hostId, input: { accountKey, includeExpiries: true } }));
  });

  it("returns only the count when the collector supplies unrequested expiry details", async () => {
    readHost.mockResolvedValue({ count: 1, expiries: [1_800_000_000] });

    await expect(host.harness.behavior.callRpc("availableResets", { threadId })).resolves.toStrictEqual({ count: 1 });
  });

  it("skips the host when BB cannot identify the account", async () => {
    listResources.mockResolvedValue({ resources: [{ ...resource, accountKey: null }] });
    await expect(host.harness.behavior.callRpc("availableResets", { threadId })).resolves.toEqual({ count: null });
    expect(readHost).not.toHaveBeenCalled();
  });

  it("keeps the quota available when the reset lookup fails", async () => {
    readHost.mockRejectedValue(new Error(providerError));
    await expect(host.harness.behavior.callRpc("availableResets", { threadId })).resolves.toEqual({ count: null });
    await expect(host.harness.behavior.callRpc("quota", { threadId })).resolves.toMatchObject({ account: { plan: "Pro" } });
    expect(readHost).toHaveBeenCalledTimes(1);
  });
});

describe("quota collector registration", () => {
  it("routes a named host collector and projects its reading onto the public quota shape", async () => {
    const window = { id: "monthly", label: "Monthly", kind: "custom" as const, remaining: 25, resetsAt };
    const reading = { account: { plan: "Example plan", observedAt, windows: [window] }, error: null };
    const privateReading = { ...reading, account: { ...reading.account, accountEmail }, accountKey };
    const readQuota = vi.fn<QuotaCollector["readQuota"]>().mockResolvedValue(privateReading);
    const adapter: QuotaAdapter = { id: "example", label: "Example usage", create: () => ({ readQuota }) };
    const multiple = createFakePluginHost({ pluginId: "codex-quota" });
    const provider = { id: adapter.id, label: adapter.label, capabilities: { resets: false } };
    const location = { hostId, providerId: adapter.id };

    try {
      createQuotaPlugin([...quotaAdapters, adapter])(multiple.bb);
      await expect(multiple.harness.behavior.callRpc("listProviders", {}))
        .resolves.toStrictEqual({ providers: [codex, provider] });
      await expect(multiple.harness.behavior.callRpc("quota", { ...location, refresh: true })).resolves.toStrictEqual(reading);
      expect(readQuota).toHaveBeenCalledExactlyOnceWith({ hostId, refresh: true, signal: expect.any(AbortSignal) });
      await expect(multiple.harness.behavior.callRpc("availableResets", location)).resolves.toStrictEqual({ count: null });

      readQuota.mockResolvedValue({ ...reading, account: { ...reading.account, windows: [{ ...window, remaining: 101 }] } });
      await expect(multiple.harness.behavior.callRpc("quota", location)).resolves.toStrictEqual(refreshFailed);
    } finally {
      await multiple.harness.lifecycle.dispose();
    }
  });

  it("rejects a second collector with an already registered provider ID", () => {
    expect(() => createQuotaPlugin([...quotaAdapters, ...quotaAdapters])(host.bb)).toThrow("Duplicate quota provider: codex");
  });

  it("gives old collectors separate fallback keys for separate providers, environments and threads", async () => {
    const readQuota = vi.fn<QuotaCollector["readQuota"]>().mockResolvedValue({
      account: { plan: "Example", observedAt, windows: [] }, error: null,
    });
    const adapter: QuotaAdapter = { id: "example", label: "Example", create: () => ({ readQuota }) };
    const multiple = createFakePluginHost({
      pluginId: "codex-quota",
      sdk: {
        environments: { get: getEnvironment },
        threads: { get: vi.fn().mockResolvedValue({ providerId: adapter.id, environmentId }) },
      },
    });

    try {
      createQuotaPlugin([adapter, { ...adapter, id: "another" }])(multiple.bb);
      const location = { threadId, providerId: adapter.id };
      const expectedSourceKey = await sourceKey(location, multiple);
      const otherThreadKey = await sourceKey({ ...location, threadId: "concurrent-thread" }, multiple);
      const envKey = await sourceKey({ environmentId, providerId: adapter.id }, multiple);
      const otherEnvironmentKey = await sourceKey({ environmentId: "other-environment", providerId: adapter.id }, multiple);
      const hostKey = await sourceKey({ hostId, providerId: adapter.id }, multiple);
      const otherProviderKey = await sourceKey({ hostId, providerId: "another" }, multiple);
      expect(new Set([expectedSourceKey, envKey, otherEnvironmentKey, hostKey, otherProviderKey, otherThreadKey]).size).toBe(6);
      expect(readQuota).not.toHaveBeenCalled();
      await expect(multiple.harness.behavior.callRpc("quota", { ...location, expectedSourceKey })).resolves.toMatchObject({ error: null });
      await expect(multiple.harness.behavior.callRpc("quota", { ...location, expectedSourceKey: otherThreadKey }))
        .resolves.toStrictEqual(unavailable);
    } finally {
      await multiple.harness.lifecycle.dispose();
    }
  });

  it("rejects an observed reset source that changed after a custom collector was called", async () => {
    const selected = { resourceId: resource.id, accountKey };
    const readAvailableResets = vi.fn<NonNullable<QuotaCollector["readAvailableResets"]>>().mockResolvedValue({
      count: 2, source: { ...selected, accountKey: "changed-account" },
    });
    const adapter: QuotaAdapter = { id: "example", label: "Example", create: () => ({
      async resolveSource() { return selected; },
      async readQuota() { return { account: null, error: "unavailable" }; },
      readAvailableResets,
    }) };
    const multiple = createFakePluginHost({ pluginId: "codex-quota" });

    try {
      createQuotaPlugin([adapter])(multiple.bb);
      const location = { hostId, providerId: adapter.id };
      const expectedSourceKey = await sourceKey(location, multiple);
      await expect(multiple.harness.behavior.callRpc("availableResets", { ...location, expectedSourceKey }))
        .resolves.toStrictEqual({ count: null });
      expect(readAvailableResets).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ source: selected }));
    } finally {
      await multiple.harness.lifecycle.dispose();
    }
  });
});
