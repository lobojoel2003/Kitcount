import { MemoryStore } from '../core/store/memory';
import type { EventStore } from '../core/store/types';

/**
 * Browser demo: an in-memory store. Nothing is persisted, so a reload is a
 * clean slate. Real deployments use the native apps with SQLCipher.
 */
export const DATABASE_NAME = 'kitcount.db';

export interface OpenDatabase {
  store: EventStore;
  encrypted: boolean;
  close(): Promise<void>;
}

let current: MemoryStore | null = null;

export async function openDatabase(keyHex: string): Promise<OpenDatabase> {
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error('Invalid database key');
  current ??= new MemoryStore();
  return { store: current, encrypted: false, close: async () => undefined };
}

export async function destroyDatabase(): Promise<void> {
  current = null;
}
