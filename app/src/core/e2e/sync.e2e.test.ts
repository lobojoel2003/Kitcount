/**
 * End-to-end: the app's sync client against a real kitcount-server.
 *
 *   KITCOUNT_DATABASE_URL=memory KITCOUNT_ADMIN_TOKEN=... kitcount-server &
 *   KITCOUNT_E2E_URL=http://127.0.0.1:8080 KITCOUNT_E2E_ADMIN_TOKEN=... npm run test:e2e
 *
 * CI runs this against a server backed by Postgres.
 */
import { Ledger } from '../domain/ledger';
import { MemoryStore } from '../store/memory';
import { syncOnce } from '../sync/sync';
import { HttpTransport } from '../sync/transport';
import { DEVICE_A, DEVICE_B, received, testKeys, visit } from '../__tests__/fixtures';

const url = process.env.KITCOUNT_E2E_URL;
const adminToken = process.env.KITCOUNT_E2E_ADMIN_TOKEN;
const run = url && adminToken ? describe : describe.skip;

async function admin(path: string, body?: unknown) {
  const res = await fetch(`${url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

run('sync against kitcount-server', () => {
  jest.setTimeout(30_000);

  it('syncs two devices, then remotely wipes one', async () => {
    const keys = testKeys();
    const a = await admin('/v1/admin/devices', { name: 'E2E van' });
    const b = await admin('/v1/admin/devices', { name: 'E2E backpack' });
    const ta = new HttpTransport(url!, a.token);
    const tb = new HttpTransport(url!, b.token);
    expect((await ta.whoami()).device.name).toBe('E2E van');

    const storeA = new MemoryStore();
    const storeB = new MemoryStore();
    const events = [received('naloxone_nasal', 48, '2026-10-01T08:00:00.000Z', DEVICE_A)];
    for (let i = 0; i < 260; i++) {
      events.push(
        visit(keys, new Date(Date.UTC(2026, 9, 1, 9, 0, i)).toISOString(), {
          code: `P${i % 40}X`,
          out: { syringes: 10, naloxone_nasal: i % 10 === 0 ? 1 : 0 },
          syringesIn: 5,
        }),
      );
    }
    await storeA.appendLocal(events);
    await storeB.appendLocal([visit(keys, '2026-10-02T12:00:00.000Z', { code: 'P1X', device: DEVICE_B, referrals: ['moud'] })]);

    // Start from the server's current head so earlier runs do not interfere.
    const head = (await admin('/v1/admin/stats')).stats.last_seq as number;
    await storeA.setMeta('sync.cursor', String(head));
    await storeB.setMeta('sync.cursor', String(head));

    const ra = await syncOnce({ store: storeA, keys, transport: ta, pushBatch: 100, pullBatch: 100 });
    expect(ra.pushed).toBe(261);
    const rb = await syncOnce({ store: storeB, keys, transport: tb });
    expect(rb).toMatchObject({ pushed: 1, pulled: 261, rejected: 0 });
    const ra2 = await syncOnce({ store: storeA, keys, transport: ta });
    expect(ra2.pulled).toBe(1);

    const la = new Ledger(await storeA.allEvents());
    const lb = new Ledger(await storeB.allEvents());
    expect(la.size).toBe(262);
    expect(lb.size).toBe(262);
    expect(la.participants().size).toBe(40);
    expect(la.onHand().naloxone_nasal).toBe(48 - 26);

    // Pushing the same events again is a no-op on the server.
    expect(await ta.push((await storeA.allEvents()).slice(0, 3).map((e) => ({ id: e.id, blob: 'A'.repeat(60) })))).toEqual({
      accepted: 0,
      duplicates: 3,
    });

    await admin(`/v1/admin/devices/${b.device.id}/wipe`, {});
    await expect(syncOnce({ store: storeB, keys, transport: tb })).rejects.toMatchObject({ kind: 'wipe' });
    await admin(`/v1/admin/devices/${b.device.id}/revoke`, {});
    await expect(tb.whoami()).rejects.toMatchObject({ kind: 'revoked' });
  });
});
