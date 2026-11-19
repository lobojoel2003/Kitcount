import { EnvelopeError, open, seal } from '../crypto/envelope';
import type { ProgramKeys } from '../crypto/keys';
import { EventValidationError, parseEvent, type KitEvent } from '../domain/events';
import { META, type EventStore } from '../store/types';
import { SyncError, type SyncTransport } from './transport';

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Records that failed decryption or validation (wrong program, corrupt). */
  rejected: number;
  cursor: number;
  /** Every valid event received this round (may include ones already stored). */
  received: KitEvent[];
}

export interface SyncOptions {
  store: EventStore;
  keys: ProgramKeys;
  transport: SyncTransport;
  pushBatch?: number;
  pullBatch?: number;
  /** Safety valve so a misbehaving server cannot loop us forever. */
  maxPages?: number;
  onProgress?: (stage: 'push' | 'pull', done: number) => void;
}

/**
 * One full sync round: upload everything pending, then download everything
 * new. Safe to interrupt at any point — pushes are idempotent (event ids are
 * unique) and the pull cursor only advances after events are stored.
 */
export async function syncOnce(opts: SyncOptions): Promise<SyncResult> {
  const { store, keys, transport } = opts;
  const pushBatch = opts.pushBatch ?? 200;
  const pullBatch = opts.pullBatch ?? 500;
  const maxPages = opts.maxPages ?? 10_000;

  // 1. Push
  let pushed = 0;
  for (let page = 0; page < maxPages; page++) {
    const batch = await store.pending(pushBatch);
    if (batch.length === 0) break;
    const records = batch.map((e) => ({ id: e.id, blob: seal(keys.syncKey, keys.programId, e.id, JSON.stringify(e)) }));
    await transport.push(records);
    await store.markSynced(batch.map((e) => e.id));
    pushed += batch.length;
    opts.onProgress?.('push', pushed);
    if (batch.length < pushBatch) break;
  }

  // 2. Pull
  let cursor = Number((await store.getMeta(META.syncCursor)) ?? '0') || 0;
  let pulled = 0;
  let rejected = 0;
  const received: KitEvent[] = [];
  for (let page = 0; page < maxPages; page++) {
    const res = await transport.pull(cursor, pullBatch);
    const events: KitEvent[] = [];
    for (const rec of res.events) {
      try {
        const event = parseEvent(JSON.parse(open(keys.syncKey, keys.programId, rec.id, rec.blob)));
        if (event.id !== rec.id) throw new EventValidationError('event id does not match record id');
        events.push(event);
      } catch (e) {
        if (e instanceof EnvelopeError || e instanceof EventValidationError || e instanceof SyntaxError) {
          rejected++;
          continue;
        }
        throw e;
      }
    }
    const inserted = await store.appendRemote(events);
    received.push(...events);
    pulled += inserted;
    if (res.next < cursor) throw new SyncError('protocol', 'Server cursor moved backwards');
    cursor = res.next;
    await store.setMeta(META.syncCursor, String(cursor));
    opts.onProgress?.('pull', pulled);
    if (!res.more || res.events.length === 0) break;
  }

  await store.setMeta(META.syncLastAt, new Date().toISOString());
  await store.setMeta(META.syncLastError, null);
  if (rejected > 0) {
    const prev = Number((await store.getMeta(META.syncRejected)) ?? '0') || 0;
    await store.setMeta(META.syncRejected, String(prev + rejected));
  }
  return { pushed, pulled, rejected, cursor, received };
}
