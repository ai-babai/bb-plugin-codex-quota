// @vitest-environment jsdom

import { useComposer } from "@get-bb/plugin-sdk/app";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { loadPluginApp, mountPluginContentScripts, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi, type TestContext } from "vitest";
import type { QuotaAdapter, QuotaReading } from "../lib/quota-adapter";
import { quotaAdapters } from "../lib/quota-adapters";
import { createQuotaPlugin, rpcContract } from "../server";

const providerId = "integration-orbit";
const providerLabel = "Orbit Lab";
const otherProviderId = "provider-without-quota";
const environmentId = "env-orbit";
const hostId = `host-for-${environmentId}`;

async function mountIntegration(onTestFinished: TestContext["onTestFinished"], initialEnvironmentId = environmentId) {
  const now = Date.now();
  const resetsAt = new Date(now + 26 * 60 * 60_000).toISOString();
  const reading = (remaining: number): QuotaReading => ({
    account: {
      plan: "Research",
      observedAt: now,
      windows: [{ id: "orbit-builds", kind: "custom", label: "Build minutes", remaining, resetsAt }],
    },
    error: null,
  });
  const readQuota = vi.fn<ReturnType<QuotaAdapter["create"]>["readQuota"]>()
    .mockImplementation(async ({ refresh }) => reading(refresh ? 22.5 : 37.5));
  const adapter = { id: providerId, label: providerLabel, create: () => ({ readQuota }) } satisfies QuotaAdapter;
  const getEnvironment = vi.fn(async (input: { environmentId: string }) => ({ hostId: `host-for-${input.environmentId}` }));
  const backend = createFakePluginHost({
    pluginId: "codex-quota",
    sdk: { environments: { get: getEnvironment } },
  });
  onTestFinished(() => backend.harness.lifecycle.dispose());
  const app = await loadPluginApp(() => import("../app"));
  const banner = app.composerCustomizations.find(item => item.scopes?.includes("new-thread"))?.banners?.[0];
  if (!banner) throw new Error("Expected the plugin's new-thread composer banner");
  const Banner = banner.component;

  function ComposerFixture() {
    const composer = useComposer();
    return <div data-app-composer-role="primary" data-promptbox-shell="">
      <button type="button" onClick={() => void composer.setSelection({ providerId })}>Select {providerLabel}</button>
      <button type="button" onClick={() => void composer.setSelection({
        providerId, environment: { type: "reuse", environmentId: `${initialEnvironmentId}-next` },
      })}>Select {providerLabel} on another machine</button>
      <button type="button" onClick={() => void composer.setSelection({ providerId: otherProviderId })}>Select other provider</button>
      <Banner />
      <div data-new-thread-footer=""><button type="button" aria-label="Permission mode" /></div>
    </div>;
  }

  createQuotaPlugin([...quotaAdapters, adapter])(backend.bb);
  const scripts = await mountPluginContentScripts(app, { pluginId: "codex-quota" });
  onTestFinished(() => scripts.lifecycle.dispose());
  const resolveSource = vi.fn((input: unknown) => backend.harness.behavior.callRpc("resolveSource", input));
  const callQuota = vi.fn((input: unknown) => backend.harness.behavior.callRpc("quota", input));
  const view = renderSlot({ component: ComposerFixture }, {}, {
    pluginId: "codex-quota",
    experimental_rpcContract: rpcContract,
    rpc: {
      listProviders: input => backend.harness.behavior.callRpc("listProviders", input),
      resolveSource,
      quota: callQuota,
      availableResets: input => backend.harness.behavior.callRpc("availableResets", input),
    },
    settings: { language: "en", refreshIntervalSeconds: 0, refreshOnHover: false, refreshOnPress: true },
    composer: {
      scope: { kind: "new-thread", projectId: "project-orbit" },
      selection: { providerId: otherProviderId, environment: { type: "reuse", environmentId: initialEnvironmentId } },
    },
  });
  onTestFinished(() => view.lifecycle.unmount());
  return { backend, callQuota, getEnvironment, reading, readQuota, resetsAt, resolveSource, view };
}

function selectProvider(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `Select ${name}` }));
}

it("renders a new provider's custom quota from composer selection without Codex calls", async ({ onTestFinished }) => {
  const { backend, callQuota, getEnvironment, reading, readQuota, resetsAt, resolveSource, view } = await mountIntegration(onTestFinished);
  await waitFor(() => expect(view.inspection.rpcCalls).toContainEqual({ method: "listProviders", input: {} }));
  expect(readQuota).not.toHaveBeenCalled();

  selectProvider(providerLabel);
  const ring = await screen.findByRole("button", { name: /Orbit Lab.*37\.5% left/i });
  expect(screen.getByRole("button", { name: "Permission mode" }).nextElementSibling?.contains(ring)).toBe(true);

  fireEvent.click(ring);
  const panel = await screen.findByRole("dialog", { name: /Orbit Lab/i });
  const card = within(panel);
  expect(card.getByRole("heading", { name: /Orbit Lab.*Research/i })).toBeTruthy();
  await waitFor(() => expect(card.getByRole("meter", { name: "Build minutes: left" }).getAttribute("aria-valuenow")).toBe("22.5"));
  expect(card.getByText("Resets in")).toBeTruthy();
  expect(panel.querySelector("time")?.dateTime).toBe(resetsAt);
  expect(card.queryByText(/Available resets/i)).toBeNull();
  expect(card.queryByRole("button", { name: /Available resets/i })).toBeNull();

  expect(readQuota).toHaveBeenCalledTimes(2);
  await expect(callQuota.mock.results[1].value).resolves.toStrictEqual(reading(22.5));
  expect(readQuota).toHaveBeenNthCalledWith(1, expect.objectContaining({ hostId, environmentId, refresh: false }));
  expect(readQuota).toHaveBeenNthCalledWith(2, expect.objectContaining({ hostId, environmentId, refresh: true }));
  expect(getEnvironment).toHaveBeenCalledWith({ environmentId });
  expect(resolveSource).toHaveBeenCalledWith({ providerId, environmentId });
  const { sourceKey } = rpcContract.resolveSource.output.parse(await resolveSource.mock.results[0].value);
  expect(sourceKey).toEqual(expect.any(String));
  expect(view.inspection.rpcCalls.filter(call => call.method === "quota")).toEqual([
    { method: "quota", input: { providerId, environmentId, expectedSourceKey: sourceKey, refresh: false } },
    { method: "quota", input: { providerId, environmentId, expectedSourceKey: sourceKey, refresh: true } },
  ]);
  expect(view.inspection.rpcCalls.map(call => call.method)).not.toContain("availableResets");
  expect(backend.harness.inspection.sdk.callsTo("plugins.callRpc")).toHaveLength(0);
  expect(backend.harness.inspection.experimental_hostRpcCalls).toHaveLength(0);
});

it("drops old quota and its in-flight refresh when the composer selects another source", async ({ onTestFinished }) => {
  const initialEnvironmentId = "env-orbit-switch";
  const nextEnvironmentId = `${initialEnvironmentId}-next`;
  const { callQuota, readQuota, reading, resolveSource } = await mountIntegration(onTestFinished, initialEnvironmentId);
  let finishPrevious!: (value: QuotaReading) => void;
  let finishCurrent!: (value: QuotaReading) => void;
  readQuota.mockResolvedValueOnce(reading(37.5))
    .mockImplementationOnce(() => new Promise(resolve => { finishPrevious = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishCurrent = resolve; }));

  selectProvider(providerLabel);
  fireEvent.click(await screen.findByRole("button", { name: /Orbit Lab.*37\.5% left/i }));
  expect(await screen.findByRole("dialog", { name: /Orbit Lab/i })).toBeTruthy();
  await waitFor(() => expect(readQuota).toHaveBeenCalledTimes(2));

  selectProvider("other provider");
  expect(screen.queryByRole("button", { name: /Orbit Lab.*37\.5% left/i })).toBeNull();
  expect(screen.queryByRole("dialog", { name: /Orbit Lab/i })).toBeNull();
  selectProvider(`${providerLabel} on another machine`);
  await waitFor(() => expect(readQuota).toHaveBeenCalledTimes(3));
  expect(screen.queryByRole("button", { name: /Orbit Lab.*37\.5% left/i })).toBeNull();
  expect(screen.getByRole("button", { name: /Orbit Lab.*Loading quota…/i })).toBeTruthy();
  expect(resolveSource).toHaveBeenCalledWith({ providerId, environmentId: nextEnvironmentId });
  expect(callQuota.mock.calls[2][0]).toEqual(expect.objectContaining({
    environmentId: nextEnvironmentId, expectedSourceKey: expect.any(String),
  }));
  expect(callQuota.mock.calls[2][0]).not.toEqual(expect.objectContaining({
    expectedSourceKey: rpcContract.resolveSource.output.parse(await resolveSource.mock.results[0].value).sourceKey,
  }));

  await act(async () => {
    finishCurrent(reading(59));
    await callQuota.mock.results[2].value;
  });
  const ring = await screen.findByRole("button", { name: /Orbit Lab.*59% left/i });
  await act(async () => {
    finishPrevious(reading(91));
    await callQuota.mock.results[1].value;
  });

  expect(screen.getByRole("button", { name: /Orbit Lab.*59% left/i })).toBe(ring);
  expect(screen.queryByRole("button", { name: /Orbit Lab.*91% left/i })).toBeNull();
});
