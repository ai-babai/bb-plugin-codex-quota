import { spawn, type ChildProcessByStdio } from "node:child_process";
import { win32 } from "node:path";
import type { Readable, Writable } from "node:stream";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { resetContract } from "./lib/reset-contract.js";

// The namespace emitted by BB's bundled provider-codex usage reader.
const accountNamespace = "openai:chatgpt:";
const readTimeoutMs = 8_000;
const shutdownGraceMs = 250;
const maxPendingChars = 256 * 1024;
const isWindows = process.platform === "win32";
const activeReads = new Set<Promise<ResetResult>>();

const replySchema = z.object({
  id: z.number(),
  method: z.unknown().optional(),
  error: z.unknown().optional(),
  result: z.unknown().optional(),
});
const rateLimitsSchema = z.object({
  accountId: z.string().min(1),
  rateLimitResetCredits: z.object({
    availableCount: z.int().nonnegative(),
    credits: z.unknown().optional(),
  }),
});
const availableCreditSchema = z.object({
  status: z.literal("available"),
  expiresAt: z.int().nonnegative().max(8_640_000_000_000).nullable(),
});

type CodexProcess = ChildProcessByStdio<Writable, Readable, null>;
type ResetQuery = z.infer<typeof resetContract.availableResets.input>;
type ResetResult = z.infer<typeof resetContract.availableResets.output>;

function windowsExecutable(name: string): string {
  return win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", name);
}

function readResets(
  child: CodexProcess,
  { accountKey, includeExpiries }: ResetQuery,
  signal: AbortSignal,
): Promise<ResetResult> {
  return new Promise((resolve) => {
    let pending = "";
    let expectedId = 1;
    let done = false;

    function finish(result: ResetResult) {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", unavailable);
      resolve(result);
    }

    function unavailable() {
      finish({ count: null });
    }

    function send(message: object) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    function handleLine(line: string) {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return unavailable();
      }

      const reply = replySchema.safeParse(message);
      if (!reply.success || reply.data.method !== undefined || reply.data.id !== expectedId) return;
      const { error, result } = reply.data;
      if (error !== undefined || result === null || typeof result !== "object" || Array.isArray(result)) {
        return unavailable();
      }

      if (expectedId === 1) {
        expectedId = 2;
        send({ method: "initialized" });
        send({ id: 2, method: "account/rateLimits/read", params: { excludeResetCreditDetails: !includeExpiries } });
        return;
      }

      const limits = rateLimitsSchema.safeParse(result);
      if (!limits.success || accountNamespace + limits.data.accountId !== accountKey) return unavailable();
      const { availableCount: count, credits } = limits.data.rateLimitResetCredits;
      if (!includeExpiries || !Array.isArray(credits)) return finish({ count });

      const expiries: (number | null)[] = [];
      for (const row of credits) {
        if (expiries.length === count) break;
        const credit = availableCreditSchema.safeParse(row);
        if (credit.success) expiries.push(credit.data.expiresAt);
      }
      finish({ count, expiries });
    }

    child.once("close", unavailable);
    child.on("error", unavailable);
    child.stdin.on("error", unavailable);
    child.stdout.on("error", unavailable);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (done) return;
      pending += chunk;
      if (pending.length > maxPendingChars) return unavailable();
      let newline = pending.indexOf("\n");
      while (!done && newline !== -1) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (line) handleLine(line);
        newline = pending.indexOf("\n");
      }
    });

    if (signal.aborted) return unavailable();
    signal.addEventListener("abort", unavailable, { once: true });
    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "bb-codex-quota", title: "BB Codex Quota", version: "0.1.0" } },
    });
  });
}

async function closeCodex(child: CodexProcess, closed: Promise<void>) {
  child.stdin.end();
  let timer: NodeJS.Timeout | undefined;
  const graceExpired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), shutdownGraceMs);
  });
  const exited = await Promise.race([closed.then(() => true), graceExpired]);
  clearTimeout(timer);
  if (exited || child.pid === undefined) return;

  try {
    if (isWindows) {
      const taskkill = spawn(windowsExecutable("taskkill.exe"), ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        timeout: 1_000,
        killSignal: "SIGKILL",
        windowsHide: true,
      });
      await new Promise<void>((resolve) => {
        taskkill.once("error", () => resolve());
        taskkill.once("close", () => resolve());
      });
      child.kill("SIGKILL");
    } else {
      // The npm launcher and its native app-server share this process group.
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    // The process may have already exited.
  } finally {
    child.stdin.destroy();
    child.stdout.destroy();
  }
}

async function queryResets(input: ResetQuery, signal: AbortSignal): Promise<ResetResult> {
  try {
    // cmd.exe resolves the npm codex.cmd shim. The command line is constant.
    const child = isWindows
      ? spawn(windowsExecutable("cmd.exe"), ["/d", "/s", "/c", "codex app-server --listen stdio://"], {
        windowsHide: true,
        windowsVerbatimArguments: true,
        stdio: ["pipe", "pipe", "ignore"],
      })
      : spawn("codex", ["app-server", "--listen", "stdio://"], {
        detached: true,
        stdio: ["pipe", "pipe", "ignore"],
      });
    const closed = new Promise<void>((resolve) => child.once("close", resolve));
    let result: ResetResult;
    try {
      result = await readResets(child, input, signal);
    } finally {
      await closeCodex(child, closed);
    }
    return signal.aborted ? { count: null } : result;
  } catch {
    return { count: null };
  }
}

export default experimental_defineHostEntry({
  contract: resetContract,
  handlers: {
    async availableResets(input, context) {
      const { accountKey } = input;
      if (!accountKey.startsWith(accountNamespace) || accountKey.length === accountNamespace.length) {
        return { count: null };
      }
      const signal = AbortSignal.any([context.signal, context.lifecycle.signal, AbortSignal.timeout(readTimeoutMs)]);
      if (signal.aborted) return { count: null };

      const reading = queryResets(input, signal);
      activeReads.add(reading);
      try {
        return await reading;
      } finally {
        activeReads.delete(reading);
      }
    },
  },
  async dispose() {
    await Promise.allSettled(activeReads);
  },
});
