import { seal } from '../crypto/envelope';
import { uuid } from '../crypto/random';
import { Ledger } from '../domain/ledger';
import { MemoryStore } from '../store/memory';
import { META } from '../store/types';
import { syncOnce } from '../sync/sync';
import { HttpTransport, normalizeServerUrl, SyncError, type PullPage, type RemoteRecord, type SyncTransport } from '../sync/transport';
import { DEVICE_A, DEVICE_B, received, testKeys, visit } from './fixtures';

/** In-memory implementation of the server side of the protocol. */
class FakeServer {
  records: RemoteRecord[] = [];
  transport(device: string): SyncTransport {
    return {
      whoami: async () => ({ device: { id: device, name: device }, server: { version: 'test' } }),
      push: async (recs) => {
        let accepted = 0;
        let duplicates = 0;
        for (const r of recs) {
          if (this.records.some((x) => x.id === r.id)) duplicates++;
          else {
            this.records.push({ seq: this.records.length + 1, id: r.id, device, blob: r.blob });
            accepted++;
          }
        }
        return { accepted, duplicates };
      },
      pull: async (after, limit): Promise<PullPage> => {
        const page = this.records.filter((r) => r.seq > after).slice(0, limit);
        const next = page.length ? page[page.length - 1].seq : after;
        return { events: page, next, more: this.records.some((r) => r.seq > next) };
      },
    };
  }
}

describe('syncOnce', () => {
  it('converges two devices through the server', async () => {
    const keys = testKeys();
    const server = new FakeServer();
    const a = new MemoryStore();
    const b = new MemoryStore();
    await a.appendLocal([received('syringes', 1000, '2026-10-01T00:00:00.000Z', DEVICE_A), visit(keys, '2026-10-01T10:00:00.000Z', { code: 'JD03', out: { syringes: 10 } })]);
    await b.appendLocal([visit(keys, '2026-10-01T11:00:00.000Z', { code: 'JD03', device: DEVICE_B })]);

    const r1 = await syncOnce({ store: a, keys, transport: server.transport(DEVICE_A), pushBatch: 1, pullBatch: 1 });
    expect(r1).toMatchObject({ pushed: 2, pulled: 0, rejected: 0, cursor: 2 });
    const r2 = await syncOnce({ store: b, keys, transport: server.transport(DEVICE_B) });
    expect(r2).toMatchObject({ pushed: 1, pulled: 2, cursor: 3 });
    const r3 = await syncOnce({ store: a, keys, transport: server.transport(DEVICE_A) });
    expect(r3).toMatchObject({ pushed: 0, pulled: 1, cursor: 3 });

    const la = new Ledger(await a.allEvents());
    const lb = new Ledger(await b.allEvents());
    expect(la.size).toBe(3);
    expect(lb.size).toBe(3);
    expect(la.participants().size).toBe(1);
    expect([...la.participants().values()][0].visits).toBe(2);
    expect(await a.pendingCount()).toBe(0);
    expect(await a.getMeta(META.syncLastAt)).not.toBeNull();

    // Idempotent: syncing again changes nothing.
    expect(await syncOnce({ store: a, keys, transport: server.transport(DEVICE_A) })).toMatchObject({ pushed: 0, pulled: 0 });
  });

  it('stores nothing readable on the server', async () => {
    const keys = testKeys();
    const server = new FakeServer();
    const store = new MemoryStore();
    await store.appendLocal([visit(keys, '2026-10-01T10:00:00.000Z', { code: 'JD03', out: { naloxone_nasal: 2 } })]);
    await syncOnce({ store, keys, transport: server.transport(DEVICE_A) });
    const dump = JSON.stringify(server.records);
    expect(dump).not.toContain('naloxone');
    expect(dump).not.toContain('visit.logged');
    expect(dump).not.toContain('JD03');
  });

  it('rejects records from another program, tampered or invalid records', async () => {
    const keys = testKeys();
    const other = testKeys();
    const server = new FakeServer();
    const foreign = visit(other, '2026-10-01T10:00:00.000Z');
    const valid = visit(keys, '2026-10-01T10:00:00.000Z');
    const mismatched = visit(keys, '2026-10-01T10:00:00.000Z');
    const badId = uuid();
    server.records.push(
      { seq: 1, id: foreign.id, device: DEVICE_B, blob: seal(other.syncKey, other.programId, foreign.id, JSON.stringify(foreign)) },
      { seq: 2, id: valid.id, device: DEVICE_B, blob: seal(keys.syncKey, keys.programId, valid.id, JSON.stringify(valid)) },
      { seq: 3, id: badId, device: DEVICE_B, blob: seal(keys.syncKey, keys.programId, badId, '{"not":"an event"}') },
      { seq: 4, id: badId, device: DEVICE_B, blob: seal(keys.syncKey, keys.programId, badId, 'not json') },
      // Valid envelope for record id `badId`, but the event inside claims a different id.
      { seq: 5, id: badId, device: DEVICE_B, blob: seal(keys.syncKey, keys.programId, badId, JSON.stringify(mismatched)) },
    );
    const store = new MemoryStore();
    const r = await syncOnce({ store, keys, transport: server.transport(DEVICE_A) });
    expect(r).toMatchObject({ pulled: 1, rejected: 4, cursor: 5 });
    expect(r.received.map((e) => e.id)).toEqual([valid.id]);
    expect(await store.getMeta(META.syncRejected)).toBe('4');
  });

  it('keeps events queued when the push fails', async () => {
    const keys = testKeys();
    const store = new MemoryStore();
    await store.appendLocal([visit(keys, '2026-10-01T10:00:00.000Z')]);
    const failing: SyncTransport = {
      whoami: jest.fn(),
      push: async () => {
        throw new SyncError('offline', 'nope');
      },
      pull: jest.fn(),
    };
    await expect(syncOnce({ store, keys, transport: failing })).rejects.toThrow('nope');
    expect(await store.pendingCount()).toBe(1);
  });

  it('refuses a cursor that moves backwards', async () => {
    const keys = testKeys();
    const store = new MemoryStore();
    await store.setMeta(META.syncCursor, '10');
    const t: SyncTransport = {
      whoami: jest.fn(),
      push: jest.fn(),
      pull: async () => ({ events: [], next: 3, more: false }),
    };
    await expect(syncOnce({ store, keys, transport: t })).rejects.toThrow(/backwards/);
  });
});

describe('HttpTransport', () => {
  const respond = (status: number, body: unknown) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

  it('sends bearer auth and parses responses', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/whoami')) return new Response(JSON.stringify({ device: { id: 'd', name: 'Van' }, server: { version: '1.0.0' } }));
      if (init?.method === 'POST') return new Response(JSON.stringify({ accepted: 1, duplicates: 0 }));
      return new Response(JSON.stringify({ events: [], next: 0, more: false }));
    };
    const t = new HttpTransport('https://sync.example.org/', 'tok', fetchImpl);
    expect((await t.whoami()).device.name).toBe('Van');
    expect(await t.push([{ id: 'x', blob: 'y' }])).toEqual({ accepted: 1, duplicates: 0 });
    expect(await t.pull(5, 100)).toEqual({ events: [], next: 0, more: false });
    expect(calls[0].url).toBe('https://sync.example.org/v1/whoami');
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(calls[1].init!.body).toBe(JSON.stringify({ events: [{ id: 'x', blob: 'y' }] }));
    expect(calls[2].url).toBe('https://sync.example.org/v1/events?after=5&limit=100');
  });

  it.each([
    [410, { error: 'device_wipe' }, 'wipe'],
    [401, { error: 'device_revoked' }, 'revoked'],
    [401, { error: 'unauthorized' }, 'unauthorized'],
    [403, {}, 'unauthorized'],
    [413, { error: 'too_large', message: 'Batch too large' }, 'rejected'],
    [400, 'oops', 'rejected'],
    [429, {}, 'server'],
    [500, {}, 'server'],
  ])('maps HTTP %i to %s', async (status, body, kind) => {
    const t = new HttpTransport('https://s.example.org', 'tok', respond(status, body));
    await expect(t.pull(0, 1)).rejects.toMatchObject({ kind });
  });

  it('maps network errors, timeouts and bad payloads', async () => {
    const offline = new HttpTransport('https://s.example.org', 't', async () => {
      throw new TypeError('Network request failed');
    });
    await expect(offline.whoami()).rejects.toMatchObject({ kind: 'offline' });

    const slow = new HttpTransport(
      'https://s.example.org',
      't',
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
      10,
    );
    await expect(slow.whoami()).rejects.toMatchObject({ kind: 'timeout' });

    await expect(new HttpTransport('https://s.example.org', 't', respond(200, 'not json')).whoami()).rejects.toMatchObject({ kind: 'protocol' });
    await expect(new HttpTransport('https://s.example.org', 't', respond(200, {})).whoami()).rejects.toMatchObject({ kind: 'protocol' });
    await expect(new HttpTransport('https://s.example.org', 't', respond(200, {})).push([])).rejects.toMatchObject({ kind: 'protocol' });
    await expect(new HttpTransport('https://s.example.org', 't', respond(200, {})).pull(0, 1)).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('requires https except on local networks', () => {
    expect(normalizeServerUrl(' https://sync.example.org/// ')).toBe('https://sync.example.org');
    expect(normalizeServerUrl('http://192.168.1.20:8080')).toBe('http://192.168.1.20:8080');
    expect(normalizeServerUrl('http://localhost:8080')).toBe('http://localhost:8080');
    expect(() => normalizeServerUrl('http://sync.example.org')).toThrow(/https/);
    expect(() => normalizeServerUrl('not a url')).toThrow(/valid URL/);
  });
});
