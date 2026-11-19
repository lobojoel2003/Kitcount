import * as SQLite from 'expo-sqlite';

import type { KitEvent } from '../core/domain/events';
import type { EventStore } from '../core/store/types';

/**
 * The on-device event store: SQLite encrypted with SQLCipher (AES-256). The
 * 256-bit key comes from the platform keystore and is applied with
 * `PRAGMA key` before anything else touches the file.
 */

export const DATABASE_NAME = 'kitcount.db';
const SCHEMA_VERSION = 1;

export interface OpenDatabase {
  store: EventStore;
  /** True when the file is encrypted with SQLCipher. */
  encrypted: boolean;
  close(): Promise<void>;
}

class SQLiteEventStore implements EventStore {
  constructor(private readonly db: SQLite.SQLiteDatabase) {}

  private async insert(events: KitEvent[], synced: 0 | 1): Promise<number> {
    if (events.length === 0) return 0;
    let inserted = 0;
    await this.db.withTransactionAsync(async () => {
      const stmt = await this.db.prepareAsync(
        'INSERT OR IGNORE INTO events (id, type, at, body, synced) VALUES ($id, $type, $at, $body, $synced)',
      );
      try {
        for (const e of events) {
          const r = await stmt.executeAsync({ $id: e.id, $type: e.type, $at: e.at, $body: JSON.stringify(e), $synced: synced });
          inserted += r.changes;
        }
      } finally {
        await stmt.finalizeAsync();
      }
    });
    return inserted;
  }

  async appendLocal(events: KitEvent[]): Promise<void> {
    await this.insert(events, 0);
  }

  appendRemote(events: KitEvent[]): Promise<number> {
    return this.insert(events, 1);
  }

  async allEvents(): Promise<KitEvent[]> {
    const rows = await this.db.getAllAsync<{ body: string }>('SELECT body FROM events ORDER BY rowid');
    return rows.map((r) => JSON.parse(r.body) as KitEvent);
  }

  async pending(limit: number): Promise<KitEvent[]> {
    const rows = await this.db.getAllAsync<{ body: string }>('SELECT body FROM events WHERE synced = 0 ORDER BY rowid LIMIT ?', limit);
    return rows.map((r) => JSON.parse(r.body) as KitEvent);
  }

  async pendingCount(): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE synced = 0');
    return row?.n ?? 0;
  }

  async markSynced(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.withTransactionAsync(async () => {
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        await this.db.runAsync(`UPDATE events SET synced = 1 WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
      }
    });
  }

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string | null): Promise<void> {
    if (value === null) await this.db.runAsync('DELETE FROM meta WHERE key = ?', key);
    else
      await this.db.runAsync(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        key,
        value,
      );
  }
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version > SCHEMA_VERSION) throw new Error('This database was created by a newer version of Kitcount. Update the app.');
  if (version === SCHEMA_VERSION) return;
  await db.withTransactionAsync(async () => {
    if (version < 1) {
      await db.execAsync(`
        CREATE TABLE events (
          id TEXT PRIMARY KEY NOT NULL,
          type TEXT NOT NULL,
          at TEXT NOT NULL,
          body TEXT NOT NULL,
          synced INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX events_pending ON events (synced) WHERE synced = 0;
        CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      `);
    }
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

export async function openDatabase(keyHex: string): Promise<OpenDatabase> {
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error('Invalid database key');
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  try {
    // Raw-key form: SQLCipher uses these 32 bytes directly (no KDF).
    await db.execAsync(`PRAGMA key = "x'${keyHex}'";`);
    const cipher = await db.getFirstAsync<{ cipher_version?: string }>('PRAGMA cipher_version');
    const encrypted = !!cipher?.cipher_version;
    if (!encrypted && !__DEV__) {
      throw new Error('This build of Kitcount was compiled without SQLCipher. Refusing to store data unencrypted.');
    }
    // Fails here if the key is wrong or the file is corrupt.
    await db.getFirstAsync('SELECT COUNT(*) FROM sqlite_master');
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON; PRAGMA foreign_keys = ON;');
    await migrate(db);
    return { store: new SQLiteEventStore(db), encrypted, close: () => db.closeAsync() };
  } catch (e) {
    await db.closeAsync().catch(() => undefined);
    throw e;
  }
}

/** Irrecoverably removes the database file (panic wipe). */
export async function destroyDatabase(): Promise<void> {
  try {
    await SQLite.deleteDatabaseAsync(DATABASE_NAME);
  } catch {
    // Already gone.
  }
}
