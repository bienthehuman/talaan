import {
  applyPull,
  applyResult,
  getMeta,
  noteFailure,
  saveReferenceData,
  setMeta,
  takeBatch,
  type TalaanDb,
} from "../db";
import { backoffMs } from "./backoff";
import { SyncFailure, type Failure } from "./classify";
import { BUSY, withSyncLock } from "./lock";
import { fetchAssignments, fetchFormVersions, pullPage, pushBatch } from "./transport";

export type EngineState =
  "idle" | "syncing" | "retrying" | "paused-auth" | "upgrade-required" | "error";
export type CycleOutcome = "ok" | "busy" | "transient" | "auth" | "upgrade" | "fatal";

export interface EngineStatus {
  state: EngineState;
  /** Epoch ms of the last cycle that completed. Display only (ADR 0002). */
  lastSyncAt: number | null;
  /** When the next automatic retry is due, while `retrying`. */
  retryAt: number | null;
  lastError: string | null;
}

export const SYNC_INTERVAL_MS = 60_000;
const MAX_BATCHES_PER_CYCLE = 200;

export interface EngineOptions {
  db: TalaanDb;
  userId: number;
  deviceId: string;
  /** Injectable for exact backoff tests. */
  random?: () => number;
}

export class SyncEngine {
  private readonly db: TalaanDb;
  private readonly userId: number;
  private readonly deviceId: string;
  private readonly random: () => number;
  private status: EngineStatus = {
    state: "idle",
    lastSyncAt: null,
    retryAt: null,
    lastError: null,
  };
  private listeners = new Set<() => void>();
  private running: Promise<CycleOutcome> | null = null;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private started = false;

  constructor(options: EngineOptions) {
    this.db = options.db;
    this.userId = options.userId;
    this.deviceId = options.deviceId;
    this.random = options.random ?? Math.random;
  }

  getStatus = (): EngineStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<EngineStatus>) {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Begin automatic syncing: now, when the browser says it is online, and every 60 seconds. */
  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener("online", this.onTrigger);
    this.interval = setInterval(this.onTrigger, SYNC_INTERVAL_MS);
    void getMeta<number>(this.db, "lastSyncAt").then((at) => {
      if (at !== null && this.status.lastSyncAt === null) this.set({ lastSyncAt: at });
    });
    this.onTrigger();
  }

  stop(): void {
    this.started = false;
    window.removeEventListener("online", this.onTrigger);
    clearInterval(this.interval);
    clearTimeout(this.retryTimer);
  }

  /** Automatic triggers do nothing while a person has to act first (sign in, update the app). */
  private onTrigger = () => {
    const { state } = this.status;
    if (state === "paused-auth" || state === "upgrade-required" || state === "error") return;
    void this.syncNow();
  };

  /** After the user signs in again or the token is refreshed. */
  resume(): Promise<CycleOutcome> {
    this.failures = 0;
    return this.syncNow();
  }

  /** Run one cycle (push, then pull, then reference data). Calls made while one is running share it. */
  syncNow(): Promise<CycleOutcome> {
    this.running ??= this.guarded().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async guarded(): Promise<CycleOutcome> {
    clearTimeout(this.retryTimer);
    const outcome = await withSyncLock(`talaan-sync-${this.userId}`, () => this.cycle());
    return outcome === BUSY ? "busy" : outcome;
  }

  private async cycle(): Promise<CycleOutcome> {
    this.set({ state: "syncing", retryAt: null });
    try {
      await this.push();
      await this.pull();
      await saveReferenceData(this.db, await fetchAssignments(), await fetchFormVersions());
      const now = Date.now();
      await setMeta(this.db, "lastSyncAt", now);
      this.failures = 0;
      this.set({ state: "idle", lastSyncAt: now, lastError: null });
      return "ok";
    } catch (error) {
      if (error instanceof SyncFailure) return this.fail(error.failure);
      throw error;
    }
  }

  private async push(): Promise<void> {
    for (let i = 0; i < MAX_BATCHES_PER_CYCLE; i++) {
      const batch = await takeBatch(this.db);
      if (batch.length === 0) return;
      let results;
      try {
        results = await pushBatch(this.deviceId, batch);
      } catch (error) {
        if (error instanceof SyncFailure) await noteFailure(this.db, batch, error.failure.reason);
        throw error;
      }
      const byId = new Map(results.map((r) => [r.mutation_id, r]));
      for (const entry of batch) {
        const result = byId.get(entry.mutationId);
        if (result) await applyResult(this.db, entry, result);
      }
      // A batch where nothing was answered would loop forever; treat it as a server fault.
      if (byId.size === 0)
        throw new SyncFailure({ kind: "transient", reason: "empty_results", retryAfterMs: 0 });
    }
  }

  private async pull(): Promise<void> {
    let cursor = (await getMeta<number>(this.db, "syncCursor")) ?? 0;
    for (;;) {
      const page = await pullPage(cursor);
      await applyPull(this.db, page.records, page.next_cursor);
      cursor = page.next_cursor;
      if (!page.has_more) return;
    }
  }

  private fail(failure: Failure): CycleOutcome {
    if (failure.kind === "transient") {
      this.failures += 1;
      const wait = backoffMs(this.failures, failure.retryAfterMs, this.random);
      this.set({ state: "retrying", retryAt: Date.now() + wait, lastError: failure.reason });
      this.retryTimer = setTimeout(() => void this.syncNow(), wait);
      return "transient";
    }
    if (failure.kind === "auth") {
      this.set({ state: "paused-auth", lastError: failure.reason });
      return "auth";
    }
    if (failure.kind === "upgrade") {
      this.set({ state: "upgrade-required", lastError: failure.reason });
      return "upgrade";
    }
    this.set({ state: "error", lastError: failure.reason });
    return "fatal";
  }
}
