import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { experimental_createHostEntryHarness, type ExperimentalHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import entry from "../host";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const mockSpawn = vi.mocked(spawn);
const accountId = "fixture-account";
const accountKey = `openai:chatgpt:${accountId}`;
const expiresAt = 1_800_000_000;
const unavailable = { count: null };

type Request = { id?: number; method: string; params?: unknown };

class FakeCodex extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly pid = 42_001;
  readonly methods: string[] = [];
  exited = false;
  private readonly requests: Request[] = [];

  constructor(exitsOnEof = true) {
    super();
    const input = createInterface({ input: this.stdin });
    input.on("line", (line) => {
      const request = JSON.parse(line) as Request;
      this.requests.push(request);
      this.methods.push(request.method);
      this.emit("request");
    });
    if (exitsOnEof) input.once("close", () => this.exit());
    mockSpawn.mockReturnValueOnce(this as unknown as ReturnType<typeof spawn>);
  }

  async nextRequest() {
    if (!this.requests.length) await once(this, "request");
    const request = this.requests.shift();
    if (!request) throw new Error("Expected a request from the host");
    return request;
  }

  send(message: object) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  exit() {
    if (this.exited) return;
    this.exited = true;
    this.stdout.end();
    this.emit("close");
  }
}

let host: ExperimentalHostEntryHarness<typeof entry.contract, {}>;

beforeEach(() => {
  mockSpawn.mockReset();
  host = experimental_createHostEntryHarness(entry);
});

afterEach(async () => {
  await host.experimental_dispose();
  vi.restoreAllMocks();
});

function readResets(includeExpiries?: boolean, signal?: AbortSignal) {
  return host.experimental_call("availableResets", { accountKey, includeExpiries }, { signal });
}

async function acceptInitialize(codex: FakeCodex) {
  const initialize = await codex.nextRequest();
  expect(initialize).toMatchObject({ id: expect.any(Number), method: "initialize" });
  codex.send({ id: initialize.id, result: {} });
  expect(await codex.nextRequest()).toStrictEqual({ method: "initialized" });
  return codex.nextRequest();
}

function usage(count: unknown, credits?: unknown, id: unknown = accountId) {
  return { accountId: id, rateLimitResetCredits: { availableCount: count, credits } };
}

describe("availableResets host RPC", () => {
  it.each([undefined, false])("reads only the count when includeExpiries is %s, preserving zero", async (flag) => {
    const codex = new FakeCodex();
    const result = readResets(flag);
    const request = await acceptInitialize(codex);
    expect(request).toStrictEqual({
      id: expect.any(Number),
      method: "account/rateLimits/read",
      params: { excludeResetCreditDetails: true },
    });
    codex.send({ id: request.id, result: usage(0, [{ status: "available", expiresAt }]) });

    await expect(result).resolves.toStrictEqual({ count: 0 });
    expect(codex.methods).toEqual(["initialize", "initialized", "account/rateLimits/read"]);
    expect(codex.stdin.writableEnded).toBe(true);
    expect(codex.exited).toBe(true);
  });

  it("handles split JSON, blank lines, notifications and other request IDs", async () => {
    const codex = new FakeCodex();
    const result = readResets();
    const initialize = await codex.nextRequest();
    codex.send({ id: initialize.id, method: "fixture/unrelated" });
    codex.send({ id: 999, result: {} });
    const reply = JSON.stringify({ id: initialize.id, result: {} });
    codex.stdout.write(`\r\n${reply.slice(0, 8)}`);
    codex.stdout.write(`${reply.slice(8)}\r\n`);
    expect(await codex.nextRequest()).toStrictEqual({ method: "initialized" });
    const request = await codex.nextRequest();

    codex.stdout.write([
      JSON.stringify({ method: "account/rateLimits/updated" }),
      JSON.stringify({ id: request.id, method: "fixture/unrelated", result: usage(99) }),
      JSON.stringify({ id: initialize.id, result: usage(99) }),
      JSON.stringify({ id: request.id, result: usage(3) }),
      "",
    ].join("\n"));
    await expect(result).resolves.toStrictEqual({ count: 3 });
  });

  it("returns at most count valid, available expiries and keeps explicit null", async () => {
    const codex = new FakeCodex();
    const result = readResets(true);
    const request = await acceptInitialize(codex);
    expect(request).toStrictEqual({
      id: expect.any(Number),
      method: "account/rateLimits/read",
      params: { excludeResetCreditDetails: false },
    });
    codex.send({ id: request.id, result: usage(2, [
      { status: "redeemed", expiresAt },
      { status: "redeeming", expiresAt: null },
      { status: "available" },
      { status: "available", expiresAt: "1800000000" },
      { status: "available", expiresAt: 1.5 },
      { status: "available", expiresAt: -1 },
      { status: "available", expiresAt: 8_640_000_000_001 },
      { status: "available", expiresAt, title: "private", id: "private" },
      { status: "available", expiresAt: null },
      { status: "available", expiresAt: expiresAt + 1 },
    ]) });

    await expect(result).resolves.toStrictEqual({ count: 2, expiries: [expiresAt, null] });
  });

  it.each([
    { name: "missing", credits: undefined, expected: { count: 3 } },
    { name: "unavailable", credits: null, expected: { count: 3 } },
    { name: "empty", credits: [], expected: { count: 3, expiries: [] } },
    {
      name: "partial", credits: [{ status: "available", expiresAt }],
      expected: { count: 3, expiries: [expiresAt] },
    },
  ])("preserves $name expiry details", async ({ credits, expected }) => {
    const codex = new FakeCodex();
    const result = readResets(true);
    const request = await acceptInitialize(codex);
    codex.send({ id: request.id, result: usage(3, credits) });

    await expect(result).resolves.toStrictEqual(expected);
  });

  it.each(["codex:fixture-account", "openai:chatgpt:"])("rejects an invalid account key before launching Codex (%s)", async (key) => {
    await expect(host.experimental_call("availableResets", { accountKey: key })).resolves.toStrictEqual(unavailable);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it.each([
    { name: "a different account", response: usage(2, [], "other") },
    { name: "an absent account", response: usage(2, [], null) },
    { name: "an unsafe count", response: usage(Number.MAX_SAFE_INTEGER + 1) },
    { name: "a negative count", response: usage(-1) },
    { name: "a missing count", response: usage(undefined) },
  ])("returns no quota information for $name", async ({ response }) => {
    const codex = new FakeCodex();
    const result = readResets(true);
    const request = await acceptInitialize(codex);
    codex.send({ id: request.id, result: response });

    await expect(result).resolves.toStrictEqual(unavailable);
  });

  it.each([{ error: { code: -1, message: "private provider error" } }, { result: null }, { result: [] }])(
    "stops before the usage request on a bad initialize response (%j)", async (details) => {
      const codex = new FakeCodex();
      const result = readResets();
      const request = await codex.nextRequest();
      codex.send({ id: request.id, ...details });

      await expect(result).resolves.toStrictEqual(unavailable);
      expect(codex.methods).toEqual(["initialize"]);
      expect(codex.exited).toBe(true);
    },
  );

  it("keeps protocol errors out of the usage result", async () => {
    const codex = new FakeCodex();
    const result = readResets(true);
    const request = await acceptInitialize(codex);
    codex.send({ id: request.id, error: { code: -1, message: "private provider error" } });

    await expect(result).resolves.toStrictEqual(unavailable);
  });

  it.each(["malformed JSON", "an oversized line"])("closes Codex after %s", async (failure) => {
    const codex = new FakeCodex();
    const result = readResets();
    await codex.nextRequest();
    codex.stdout.write(failure === "malformed JSON" ? "{\n" : "x".repeat(300 * 1024));

    await expect(result).resolves.toStrictEqual(unavailable);
    expect(codex.exited).toBe(true);
  });

  it("returns unavailable when the process exits before replying", async () => {
    const codex = new FakeCodex();
    const result = readResets();
    await acceptInitialize(codex);
    codex.exit();

    await expect(result).resolves.toStrictEqual(unavailable);
    expect(codex.stdin.writableEnded).toBe(true);
  });

  it("returns unavailable when the executable cannot be started", async () => {
    mockSpawn.mockImplementationOnce(() => { throw new Error("Codex spawn failed"); });

    await expect(readResets()).resolves.toStrictEqual(unavailable);
  });

  it("does not launch Codex if the call is already cancelled", async () => {
    await expect(readResets(undefined, AbortSignal.abort())).resolves.toStrictEqual(unavailable);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("closes the process when the call is cancelled during a read", async () => {
    const codex = new FakeCodex();
    const controller = new AbortController();
    const result = readResets(true, controller.signal);
    await acceptInitialize(codex);
    controller.abort();

    await expect(result).resolves.toStrictEqual(unavailable);
    expect(codex.stdin.writableEnded).toBe(true);
    expect(codex.exited).toBe(true);
  });

  it("keeps waiting before the deadline and closes Codex at the timeout", async () => {
    const timeoutSignal = new AbortController();
    let elapsedMs = 0;
    let deadlineMs = Infinity;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      deadlineMs = elapsedMs + ms;
      return timeoutSignal.signal;
    });

    function advanceTimeout(ms: number) {
      elapsedMs += ms;
      if (elapsedMs >= deadlineMs) timeoutSignal.abort(new DOMException("The operation timed out", "TimeoutError"));
      return new Promise<void>((resolve) => setImmediate(resolve));
    }

    const codex = new FakeCodex();
    const settled = vi.fn();
    void readResets().then(settled, settled);
    await acceptInitialize(codex);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(8_000);

    await advanceTimeout(7_999);
    expect(settled).not.toHaveBeenCalled();
    expect(codex.stdin.writableEnded).toBe(false);
    expect(codex.exited).toBe(false);

    await advanceTimeout(1);
    expect(settled).toHaveBeenCalledExactlyOnceWith(unavailable);
    expect(codex.stdin.writableEnded).toBe(true);
    expect(codex.exited).toBe(true);
  });

  it.skipIf(process.platform === "win32")("disposal waits for forced shutdown when stdin EOF is ignored", async () => {
    const codex = new FakeCodex(false);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      codex.exit();
      return true;
    });
    const result = readResets();
    await acceptInitialize(codex);

    await host.experimental_dispose();

    await expect(result).resolves.toStrictEqual(unavailable);
    expect(kill).toHaveBeenCalledExactlyOnceWith(-codex.pid, "SIGKILL");
    expect(codex.stdin.destroyed).toBe(true);
    expect(codex.stdout.destroyed).toBe(true);
  });
});
