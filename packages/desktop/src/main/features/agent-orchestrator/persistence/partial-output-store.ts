import type Store from "electron-store";

import type { StorageService } from "../../../core/storage-service";

interface PartialEntry {
  content: unknown;
  timestamp: string;
}

export class PartialOutputStore {
  private store: Store;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private buffers = new Map<string, PartialEntry>();

  constructor(storage: StorageService) {
    this.store = storage.scoped("orchestrator/partial-outputs");
  }

  private key(runId: string, instanceId: string): string {
    return `${runId}:${instanceId}`;
  }

  write(runId: string, instanceId: string, content: unknown): void {
    const k = this.key(runId, instanceId);
    const entry: PartialEntry = { content, timestamp: new Date().toISOString() };
    this.buffers.set(k, entry);

    // debounce 100ms
    const existing = this.timers.get(k);
    if (existing) clearTimeout(existing);

    this.timers.set(
      k,
      setTimeout(() => {
        this.flushOne(k);
      }, 100),
    );
  }

  private flushOne(k: string): void {
    const entry = this.buffers.get(k);
    if (entry) {
      this.store.set(k, entry);
      this.buffers.delete(k);
    }
    this.timers.delete(k);
  }

  flush(runId: string, instanceId: string): void {
    const k = this.key(runId, instanceId);
    this.flushOne(k);
  }

  get(runId: string, instanceId: string): unknown | undefined {
    const k = this.key(runId, instanceId);
    // return buffer if available, otherwise read from store
    const buffered = this.buffers.get(k);
    if (buffered) return buffered.content;

    const entry = this.store.get(k) as PartialEntry | undefined;
    return entry?.content;
  }

  flushAll(): void {
    for (const k of this.buffers.keys()) {
      this.flushOne(k);
    }
  }

  clear(runId: string, instanceId: string): void {
    const k = this.key(runId, instanceId);
    const timer = this.timers.get(k);
    if (timer) clearTimeout(timer);
    this.timers.delete(k);
    this.buffers.delete(k);
    this.store.delete(k);
  }
}
