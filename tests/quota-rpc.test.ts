import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotaAdapter, QuotaCollector } from "../lib/quota-adapter";
import { quotaAdapters } from "../lib/quota-adapters";
import plugin, { createQuotaPlugin } from "../server";

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

  it("returns measured quota when the provider has no account identity or plan label", async () => {
    getResource.mockResolvedValue({
      accountKey: null,
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
});
