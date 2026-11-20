import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { Quota, QuotaLocation, rpcContract } from "../server";
import { isFresh } from "./quota-time";

type Rpc = PluginRpcClient<typeof rpcContract>;
export type QuotaSnapshot = { data: Quota | null; sourceKey: string | null; now: number; loading: boolean };
type Options = { intervalSeconds: number; confirmedProvider: boolean };
type Request = { refresh: boolean; promise: Promise<Quota | null> };
type Task = { refresh: boolean; promise: Promise<void>; phase: "resolve" | "read" | "wait" };
type Source = {
  key: string; data: Quota | null; now: number; members: Set<QuotaSubscription>;
  request?: Request; task?: Task; confirmed: boolean; lastThreadId?: string; idleSince: number;
  clock?: number; poll?: number; interval?: number;
  wait?: { timer: number; finish: () => void };
};

const sources = new Map<string, Source>();
const resolving = new Map<string, Promise<string | null>>();
type Unresolved = { members: Set<QuotaSubscription>; timer?: number; interval?: number };
const unresolved = new Map<string, Unresolved>();
const retentionMs = 5 * 60_000;
const retainedSources = 32;
const retryDelays = [250, 1000];

export function quotaLocationKey(location: QuotaLocation) {
  const scope = "threadId" in location ? ["thread", location.threadId]
    : "environmentId" in location ? ["environment", location.environmentId] : ["host", location.hostId];
  return JSON.stringify([location.providerId, ...scope]);
}

function fresh(data: Quota | null) {
  if (!data?.account || data.error || !isFresh(data.account.observedAt, Date.now())) return false;
  return !data.account.windows.some(window => window.resetsAt && Date.parse(window.resetsAt) <= Date.now());
}

function prune() {
  const idle = [...sources.values()].filter(source => source.members.size === 0);
  for (const source of idle) {
    if (Date.now() - source.idleSince >= retentionMs) sources.delete(source.key);
  }
  const remaining = idle.filter(source => sources.has(source.key)).sort((a, b) => a.idleSince - b.idleSince);
  for (const source of remaining.slice(0, Math.max(0, remaining.length - retainedSources))) sources.delete(source.key);
}

function sourceFor(key: string) {
  prune();
  let source = sources.get(key);
  if (!source) {
    source = { key, data: null, now: Date.now(), members: new Set(), confirmed: false, idleSince: Date.now() };
    sources.set(key, source);
  }
  if (source.members.size === 0 && !fresh(source.data)) { source.data = null; source.confirmed = false; }
  return source;
}

function publish(source: Source) {
  source.now = Date.now();
  for (const member of source.members) member.publish();
}

function stopTimers(source: Source) {
  window.clearInterval(source.clock);
  window.clearInterval(source.poll);
  source.clock = undefined;
  source.poll = undefined;
  source.interval = undefined;
  if (source.wait) {
    window.clearTimeout(source.wait.timer);
    source.wait.finish();
    source.wait = undefined;
  }
}

function schedule(source: Source) {
  if (!source.members.size) { stopTimers(source); return; }
  source.clock ??= window.setInterval(() => publish(source), 15_000);
  const intervals = [...source.members].map(member => member.options.intervalSeconds).filter(value => value > 0);
  const interval = intervals.length ? Math.min(...intervals) : 0;
  if (interval === source.interval) return;
  window.clearInterval(source.poll);
  source.interval = interval;
  if (interval) source.poll = window.setInterval(() => {
    if (!document.hidden) void runTask(source, true, true);
  }, interval * 1000);
}

function resolveSource(member: QuotaSubscription, force = false) {
  const key = quotaLocationKey(member.location);
  let pending = force ? undefined : resolving.get(key);
  if (!pending) {
    pending = member.rpc.call("resolveSource", member.location).then(result => result.sourceKey).catch(() => null);
    resolving.set(key, pending);
    const current = pending;
    void pending.finally(() => { if (resolving.get(key) === current) resolving.delete(key); });
  }
  return pending;
}

function read(source: Source, member: QuotaSubscription, refresh: boolean) {
  if (source.request && (!refresh || source.request.refresh)) return source.request.promise;
  const request: Request = { refresh, promise: Promise.resolve(null) };
  source.request = request;
  request.promise = member.rpc.call("quota", { ...member.location, refresh, expectedSourceKey: source.key })
    .catch((): Quota => ({ account: null, error: "refresh_failed" }))
    .then(result => {
      if (source.request !== request || sources.get(source.key) !== source) return null;
      if (result.account && !result.error) { source.data = result; publish(source); }
      return result;
    }).finally(() => { if (source.request === request) source.request = undefined; });
  return request.promise;
}

async function revalidate(members: QuotaSubscription[], force: boolean, valid: () => boolean) {
  const reads = new Map<string, Promise<string | null>>();
  await Promise.all(members.map(async member => {
    const key = quotaLocationKey(member.location);
    let pending = reads.get(key);
    if (!pending) { pending = resolveSource(member, force); reads.set(key, pending); }
    await member.resolve(pending, valid);
  }));
}

function wait(source: Source, milliseconds: number, members: QuotaSubscription[]) {
  return new Promise<void>(resolve => {
    const finish = () => {
      window.clearTimeout(timer);
      source.wait = undefined;
      for (const member of members) member.idleChecks.delete(cancelIfUnused);
      resolve();
    };
    const cancelIfUnused = () => { if (members.every(member => !member.active)) finish(); };
    const timer = window.setTimeout(finish, milliseconds);
    for (const member of members) member.idleChecks.add(cancelIfUnused);
    source.wait = { timer, finish };
  });
}

async function readGroups(members: QuotaSubscription[], refresh: boolean) {
  const groups = new Map<Source, QuotaSubscription[]>();
  for (const member of members) {
    if (member.source) groups.set(member.source, [...groups.get(member.source) ?? [], member]);
  }
  const failures = new Map<Source, Quota>();
  await Promise.all([...groups].map(async ([source, group]) => {
    const confirmed = group.some(member => member.confirmedStartup);
    for (const member of group) member.confirmedStartup = false;
    const result = await read(source, group[0], refresh || confirmed);
    if (result && (!result.account || result.error)) failures.set(source, result);
  }));
  return failures;
}

function pendingMembers(members: QuotaSubscription[], failures: Map<Source, Quota>) {
  return members.filter(member => member.active && (!member.source || failures.has(member.source)));
}

async function attemptRead(source: Source, task: Task, members: QuotaSubscription[], attempt: number, resolveFirst: boolean) {
  if (attempt) { task.phase = "wait"; await wait(source, retryDelays[attempt - 1], members); }
  if (source.task !== task) return null;
  if (resolveFirst || attempt) {
    task.phase = "resolve";
    await revalidate(members, task.refresh, () => source.task === task);
  }
  if (source.task !== task) return null;
  task.phase = "read";
  const failures = await readGroups(members.filter(member => member.active), task.refresh);
  return source.task === task ? failures : null;
}

function failSources(failures: Map<Source, Quota>) {
  for (const [failed, result] of failures) {
    if (!fresh(failed.data)) failed.data = result;
    publish(failed);
  }
}

async function performTask(source: Source, task: Task, resolveFirst: boolean) {
  let remaining = [...source.members];
  let failures = new Map<Source, Quota>();
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    remaining = remaining.filter(member => member.active);
    if (!remaining.length) return;
    const failed = await attemptRead(source, task, remaining, attempt, resolveFirst);
    if (!failed) return;
    failures = failed;
    remaining = pendingMembers(remaining, failures);
    if (!remaining.length) return;
  }
  failSources(failures);
}

function runTask(source: Source, refresh: boolean, resolveFirst: boolean) {
  const recheck = refresh && resolveFirst && source.task?.phase === "read";
  if (source.task && !recheck && (!refresh || source.task.refresh)) return source.task.promise;
  source.wait?.finish();
  const task: Task = { refresh, promise: Promise.resolve(), phase: resolveFirst ? "resolve" : "read" };
  source.task = task;
  publish(source);
  task.promise = performTask(source, task, resolveFirst).finally(() => {
    if (source.task === task) source.task = undefined;
    publish(source);
  });
  return task.promise;
}

function scheduleUnresolved(member: QuotaSubscription, enabled: boolean) {
  const key = quotaLocationKey(member.location);
  let entry = unresolved.get(key);
  if (!entry && enabled) { entry = { members: new Set() }; unresolved.set(key, entry); }
  if (!entry) return;
  if (enabled) entry.members.add(member);
  else entry.members.delete(member);
  const intervals = [...entry.members].map(item => item.options.intervalSeconds).filter(value => value > 0);
  const interval = intervals.length ? Math.min(...intervals) : 0;
  if (interval !== entry.interval) {
    window.clearInterval(entry.timer);
    entry.interval = interval;
    if (interval) entry.timer = window.setInterval(() => {
      if (!document.hidden) for (const subscriber of entry!.members) void subscriber.load();
    }, interval * 1000);
  }
  if (!entry.members.size) unresolved.delete(key);
}

function snapshotFor(source: Source | null, waiting: boolean): QuotaSnapshot {
  if (!source) return { data: null, sourceKey: null, now: Date.now(), loading: waiting };
  const busy = waiting || Boolean(source.task) || Boolean(source.request);
  return { data: source.data, sourceKey: source.key, now: source.now, loading: source.data === null && busy };
}

function claimStartup(member: QuotaSubscription, source: Source) {
  if (!member.options.confirmedProvider || member.location.providerId !== "codex") return false;
  const threadId = "threadId" in member.location ? member.location.threadId : undefined;
  const differentThread = Boolean(threadId && source.lastThreadId && threadId !== source.lastThreadId);
  if (threadId) source.lastThreadId = threadId;
  const needed = !source.confirmed || differentThread;
  source.confirmed = true;
  return needed;
}

/** One mounted scope; all actual readings and timers belong to opaque sources. */
export class QuotaSubscription {
  source: Source | null = null;
  active = false;
  confirmedStartup = false;
  readonly idleChecks = new Set<() => void>();
  options: Options;
  private listeners = new Set<() => void>();
  private snapshot: QuotaSnapshot = { data: null, sourceKey: null, now: Date.now(), loading: true };
  private generation = 0;
  private identityVersion = 0;
  private waiting = false;
  private retry?: { timer: number; finish: () => void };

  constructor(readonly rpc: Rpc, readonly location: QuotaLocation, options: Options) {
    this.options = options;
    this.getSnapshot = this.getSnapshot.bind(this);
    this.subscribe = this.subscribe.bind(this);
    this.load = this.load.bind(this);
    this.resume = this.resume.bind(this);
  }

  getSnapshot() { return this.snapshot; }

  publish() {
    if (!this.active) return;
    this.snapshot = snapshotFor(this.source, this.waiting);
    for (const notify of this.listeners) notify();
  }

  attach(sourceKey: string | null) {
    scheduleUnresolved(this, sourceKey === null && this.active);
    if (this.source?.key === sourceKey) { this.publish(); return; }
    this.detach();
    this.source = sourceKey ? sourceFor(sourceKey) : null;
    if (this.source) {
      this.confirmedStartup = claimStartup(this, this.source);
      this.source.members.add(this); schedule(this.source); publish(this.source);
    }
    else this.publish();
  }

  async resolve(pending: Promise<string | null>, valid: () => boolean) {
    const version = ++this.identityVersion;
    const key = await pending;
    if (!this.active || version !== this.identityVersion || !valid()) return false;
    this.attach(key);
    return key !== null;
  }

  private detach() {
    if (!this.source) return;
    const source = this.source;
    source.members.delete(this);
    source.idleSince = Date.now();
    schedule(source);
    this.source = null;
    prune();
  }

  private pause(milliseconds: number) {
    return new Promise<void>(finish => {
      const timer = window.setTimeout(() => { this.retry = undefined; finish(); }, milliseconds);
      this.retry = { timer, finish };
    });
  }

  private async locate(generation: number, refresh: boolean) {
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      if (attempt) await this.pause(retryDelays[attempt - 1]);
      if (!this.active || generation !== this.generation) return;
      const ready = await this.resolve(resolveSource(this, refresh), () => generation === this.generation);
      if (!this.active || generation !== this.generation) return;
      if (ready) return;
    }
  }

  async load(refresh = false) {
    const generation = ++this.generation;
    if (this.retry) { window.clearTimeout(this.retry.timer); this.retry.finish(); this.retry = undefined; }
    this.waiting = true;
    this.publish();
    try {
      if (this.source) await runTask(this.source, refresh, true);
      else {
        await this.locate(generation, refresh);
        if (!this.active || generation !== this.generation || !this.source) return;
        await this.startSource(refresh);
      }
    } finally {
      if (this.active && generation === this.generation) { this.waiting = false; this.publish(); }
    }
  }

  private startSource(refresh: boolean) {
    const source = this.source!;
    if (refresh || this.confirmedStartup) return runTask(source, true, false);
    if (source.task) return source.task.promise;
    if (fresh(source.data)) return Promise.resolve();
    return runTask(source, false, false);
  }

  configure(options: Options) {
    const wasConfirmed = this.options.confirmedProvider;
    this.options = options;
    scheduleUnresolved(this, this.active && this.source === null);
    if (this.source) schedule(this.source);
    if (this.active && !wasConfirmed && this.source) {
      this.confirmedStartup ||= claimStartup(this, this.source);
      if (this.confirmedStartup) void this.load(true);
    }
  }

  private resume() { if (!document.hidden) void this.load(); }

  subscribe(notify: () => void) {
    this.listeners.add(notify);
    this.active = true;
    void this.load();
    window.addEventListener("focus", this.resume);
    document.addEventListener("visibilitychange", this.resume);
    return () => {
      this.listeners.delete(notify);
      this.active = false;
      for (const check of this.idleChecks) check();
      this.generation++;
      this.identityVersion++;
      if (this.retry) { window.clearTimeout(this.retry.timer); this.retry.finish(); this.retry = undefined; }
      this.detach();
      scheduleUnresolved(this, false);
      window.removeEventListener("focus", this.resume);
      document.removeEventListener("visibilitychange", this.resume);
    };
  }
}
