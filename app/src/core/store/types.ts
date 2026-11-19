import type { KitEvent } from '../domain/events';

/**
 * Persistence for the event log. The native implementation is SQLCipher
 * (src/platform/sqlite-store.ts); MemoryStore backs tests and the web demo.
 */
export interface EventStore {
  /** Events recorded on this device. They are queued for upload. */
  appendLocal(events: KitEvent[]): Promise<void>;
  /** Events received from the sync server. Duplicates are ignored. Returns the number inserted. */
  appendRemote(events: KitEvent[]): Promise<number>;
  allEvents(): Promise<KitEvent[]>;
  /** Oldest-first events not yet acknowledged by the server. */
  pending(limit: number): Promise<KitEvent[]>;
  pendingCount(): Promise<number>;
  markSynced(ids: string[]): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string | null): Promise<void>;
}

export const META = {
  deviceId: 'device.id',
  deviceName: 'device.name',
  syncCursor: 'sync.cursor',
  syncLastAt: 'sync.lastAt',
  syncLastError: 'sync.lastError',
  syncRejected: 'sync.rejected',
} as const;
