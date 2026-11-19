import { defaultCatalog } from '../domain/catalog';
import { createEvent } from '../domain/events';
import { DEFAULT_CONFIG, Ledger } from '../domain/ledger';
import { DEVICE_A, DEVICE_B, received, testKeys, visit } from './fixtures';

describe('Ledger', () => {
  const keys = testKeys();

  it('ignores duplicate events and tracks revisions', () => {
    const v = visit(keys, '2026-10-01T10:00:00.000Z', { code: 'AA01' });
    const l = new Ledger([v]);
    expect(l.size).toBe(1);
    expect(l.has(v.id)).toBe(true);
    const rev = l.revision;
    expect(l.apply([v])).toBe(0);
    expect(l.revision).toBe(rev);
    expect(l.apply([visit(keys, '2026-10-01T11:00:00.000Z')])).toBe(1);
    expect(l.revision).toBe(rev + 1);
  });

  it('computes stock per device and program-wide', () => {
    const l = new Ledger([
      received('syringes', 1000, '2026-10-01T08:00:00.000Z', DEVICE_A),
      received('syringes', 500, '2026-10-01T08:00:00.000Z', DEVICE_B),
      createEvent(
        DEVICE_A,
        { type: 'stock.adjusted', supply: 'syringes', delta: -50, reason: 'damaged' },
        new Date('2026-10-01T09:00:00.000Z'),
      ),
      visit(keys, '2026-10-01T10:00:00.000Z', { out: { syringes: 30 }, device: DEVICE_A }),
      visit(keys, '2026-10-01T10:05:00.000Z', { out: { syringes: 20 }, device: DEVICE_B }),
    ]);
    expect(l.onHand(DEVICE_A).syringes).toBe(920);
    expect(l.onHand(DEVICE_B).syringes).toBe(480);
    expect(l.onHand().syringes).toBe(1400);
    expect(l.onHand('33333333-3333-4333-8333-333333333333')).toEqual({});
    expect(l.onHandAt(new Date('2026-10-01T10:01:00.000Z')).syringes).toBe(1420);
    expect(l.stockEvents()).toHaveLength(3);
  });

  it('excludes voided visits everywhere', () => {
    const v1 = visit(keys, '2026-10-01T10:00:00.000Z', { code: 'AA01', out: { syringes: 10 } });
    const v2 = visit(keys, '2026-10-02T10:00:00.000Z', { code: 'AA01', out: { syringes: 10 } });
    const voidEvent = createEvent(DEVICE_A, { type: 'visit.voided', visit: v2.id });
    // The void can arrive before the visit it voids.
    const l = new Ledger([voidEvent, received('syringes', 100, '2026-10-01T00:00:00.000Z'), v1, v2]);
    expect(l.visits().map((v) => v.id)).toEqual([v1.id]);
    expect(l.isVoided(v2.id)).toBe(true);
    expect(l.onHand(DEVICE_A).syringes).toBe(90);
    expect(l.participant(v1.participant!)).toEqual({ visits: 1, firstAt: v1.at, lastAt: v1.at });
    const recent = l.recentVisits(10);
    expect(recent.map((r) => [r.visit.id, r.voided])).toEqual([
      [v2.id, true],
      [v1.id, false],
    ]);
    expect(l.recentVisits(10, DEVICE_B)).toEqual([]);
  });

  it('summarises participants across devices', () => {
    const l = new Ledger([
      visit(keys, '2026-10-05T10:00:00.000Z', { code: 'JD03', device: DEVICE_B }),
      visit(keys, '2026-09-01T10:00:00.000Z', { code: 'jd 03' }),
      visit(keys, '2026-10-01T10:00:00.000Z', { code: 'JD03' }),
      visit(keys, '2026-10-01T10:00:00.000Z', { code: null }),
    ]);
    const hash = l.visits()[0].participant!;
    expect(l.participants().size).toBe(1);
    expect(l.participant(hash)).toEqual({ visits: 3, firstAt: '2026-09-01T10:00:00.000Z', lastAt: '2026-10-05T10:00:00.000Z' });
    expect(l.participant('0'.repeat(32))).toBeNull();
  });

  it('selects visits in a half-open range', () => {
    const l = new Ledger([
      visit(keys, '2026-09-30T23:59:59.999Z'),
      visit(keys, '2026-10-01T00:00:00.000Z'),
      visit(keys, '2026-10-31T23:59:59.999Z'),
      visit(keys, '2026-11-01T00:00:00.000Z'),
    ]);
    const got = l.visitsBetween(new Date('2026-10-01T00:00:00.000Z'), new Date('2026-11-01T00:00:00.000Z'));
    expect(got.map((v) => v.at)).toEqual(['2026-10-01T00:00:00.000Z', '2026-10-31T23:59:59.999Z']);
  });

  it('resolves configuration last-writer-wins regardless of arrival order', () => {
    const older = createEvent(
      DEVICE_A,
      { type: 'config.set', key: 'programName', value: 'Old name' },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const newer = createEvent(
      DEVICE_B,
      { type: 'config.set', key: 'programName', value: 'New name' },
      new Date('2026-02-01T00:00:00.000Z'),
    );
    expect(new Ledger([newer, older]).config().programName).toBe('New name');
    expect(new Ledger([older, newer]).config().programName).toBe('New name');
    expect(new Ledger().config()).toEqual(DEFAULT_CONFIG);

    // Same timestamp: the higher id wins deterministically on every device.
    const at = new Date('2026-03-01T00:00:00.000Z');
    const x = createEvent(DEVICE_A, { type: 'config.set', key: 'codeHint', value: 'x' }, at);
    const y = createEvent(DEVICE_B, { type: 'config.set', key: 'codeHint', value: 'y' }, at);
    const winner = x.id > y.id ? 'x' : 'y';
    expect(new Ledger([x, y]).config().codeHint).toBe(winner);
    expect(new Ledger([y, x]).config().codeHint).toBe(winner);
  });

  it('warns about low stock with critical supplies first and forecasts visits left', () => {
    const catalog = defaultCatalog();
    const events = [
      createEvent(DEVICE_A, { type: 'config.set', key: 'catalog', value: catalog }, new Date('2026-01-01T00:00:00.000Z')),
      received('naloxone_nasal', 30, '2026-10-01T00:00:00.000Z'),
      received('syringes', 450, '2026-10-01T00:00:00.000Z'),
      received('cookers', 1000, '2026-10-01T00:00:00.000Z'),
    ];
    for (let i = 0; i < 10; i++) {
      events.push(visit(keys, `2026-10-1${i}T12:00:00.000Z`, { out: { naloxone_nasal: 1, syringes: 10 } }));
    }
    const l = new Ledger(events);
    const now = new Date('2026-10-20T00:00:00.000Z');
    const low = l.lowStock(DEVICE_A, now);
    // Critical supplies first (lowest stock first), then everything else.
    expect(low.slice(0, 2).map((s) => s.supply.id)).toEqual(['naloxone_im', 'naloxone_nasal']);
    const nasal = low[1];
    expect(nasal.onHand).toBe(20);
    expect(nasal.visitsLeft).toBe(20);
    expect(low.map((s) => s.supply.id)).toContain('syringes');
    expect(low.map((s) => s.supply.id)).not.toContain('cookers');
    const levels = l.stockLevels(DEVICE_A, now);
    expect(levels.find((s) => s.supply.id === 'cookers')!.visitsLeft).toBeNull();
    expect(levels.some((s) => s.supply.id === 'hygiene_kits')).toBe(false);
    // Too few recent visits: no forecast.
    expect(l.perVisitRate('syringes', DEVICE_A, new Date('2027-01-01T00:00:00.000Z'))).toBeNull();
  });
});
