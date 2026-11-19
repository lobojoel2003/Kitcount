import { hashCode } from '../core/crypto/codes';
import type { ProgramKeys } from '../core/crypto/keys';
import { createEvent, type KitEvent } from '../core/domain/events';
import { Ledger } from '../core/domain/ledger';

/**
 * Realistic synthetic data for the browser demo and README screenshots:
 * roughly three months of outreach by two devices. Entirely made up.
 */

const OTHER_DEVICE = '7d1e5c2a-4b8f-4e21-9a3d-2f6b8c0e1a55';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = 'ABCDEFGHJKLMNPRSTW';

function codes(rand: () => number, n: number): string[] {
  const out = new Set<string>();
  while (out.size < n) {
    const a = LETTERS[Math.floor(rand() * LETTERS.length)];
    const b = LETTERS[Math.floor(rand() * LETTERS.length)];
    const m = String(1 + Math.floor(rand() * 12)).padStart(2, '0');
    out.add(`${a}${b}${m}`);
  }
  return [...out];
}

const REFERRALS = [
  'moud',
  'moud',
  'sud_treatment',
  'hiv_testing',
  'hcv_testing',
  'hcv_testing',
  'medical',
  'mental_health',
  'housing',
  'benefits',
  'prep',
];

function visitBody(rand: () => number, participant: string | null) {
  const out: Record<string, number> = {};
  const syringes = rand() < 0.88 ? 10 * (1 + Math.floor(rand() * rand() * 10)) : 0;
  if (syringes) out.syringes = syringes;
  if (rand() < 0.22) out.naloxone_nasal = rand() < 0.75 ? 1 : 2;
  if (rand() < 0.05) out.naloxone_im = 1;
  if (rand() < 0.42) out.fentanyl_strips = 5 * (1 + Math.floor(rand() * 2));
  if (rand() < 0.18) out.xylazine_strips = 5;
  if (syringes && rand() < 0.7) out.cookers = 5 * Math.max(1, Math.round(syringes / 30));
  if (syringes && rand() < 0.65) out.cottons = 10 * Math.max(1, Math.round(syringes / 30));
  if (syringes && rand() < 0.55) out.sterile_water = 5 * Math.max(1, Math.round(syringes / 40));
  if (syringes && rand() < 0.6) out.alcohol_pads = 10 * Math.max(1, Math.round(syringes / 20));
  if (rand() < 0.12) out.tourniquets = 1;
  if (rand() < 0.1) out.sharps_containers = 1;
  if (rand() < 0.07) out.wound_care = 1;
  if (rand() < 0.14) out.smoking_kits = 1;
  if (rand() < 0.16) out.condoms = 5;
  const syringesIn = syringes ? Math.round(syringes * (0.45 + rand() * 0.6)) : rand() < 0.1 ? 10 : 0;
  const referrals = rand() < 0.11 ? [REFERRALS[Math.floor(rand() * REFERRALS.length)]] : [];
  return {
    type: 'visit.logged' as const,
    participant,
    out,
    syringesIn,
    reversals: rand() < 0.035 ? 1 : 0,
    referrals,
    secondary: rand() < 0.12 ? 1 + Math.floor(rand() * 3) : 0,
  };
}

/** History that has already been synced from the server. */
export function demoHistory(keys: ProgramKeys, deviceId: string, now = new Date()): KitEvent[] {
  const rand = mulberry32(20261119);
  const people = codes(rand, 160).map((c) => hashCode(keys.codeKey, c));
  const events: KitEvent[] = [];
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1, 8);

  events.push(
    createEvent(
      OTHER_DEVICE,
      { type: 'config.set', key: 'codeHint', value: 'First + last initial, then birth month (e.g. JD03)' },
      new Date(start.getTime() - 86_400_000),
    ),
  );
  for (const [device, scale] of [
    [deviceId, 1],
    [OTHER_DEVICE, 1],
  ] as const) {
    events.push(createEvent(device, { type: 'stock.received', supply: 'syringes', qty: 20000 * scale }, start));
    events.push(createEvent(device, { type: 'stock.received', supply: 'naloxone_nasal', qty: 240 }, start));
    events.push(createEvent(device, { type: 'stock.received', supply: 'naloxone_im', qty: 60 }, start));
    for (const s of ['fentanyl_strips', 'cookers', 'cottons', 'sterile_water', 'alcohol_pads']) {
      events.push(createEvent(device, { type: 'stock.received', supply: s, qty: 6000 }, start));
    }
    for (const s of ['xylazine_strips', 'condoms'])
      events.push(createEvent(device, { type: 'stock.received', supply: s, qty: 2500 }, start));
    for (const s of ['tourniquets', 'sharps_containers', 'wound_care', 'smoking_kits'])
      events.push(createEvent(device, { type: 'stock.received', supply: s, qty: 400 }, start));
  }

  // Frequent visitors come back more often (a few people account for most encounters).
  const weights = people.map((_, i) => 1 / (1 + i * 0.08));
  const total = weights.reduce((a, b) => a + b, 0);
  const pick = () => {
    let r = rand() * total;
    for (let i = 0; i < people.length; i++) {
      r -= weights[i];
      if (r <= 0) return people[i];
    }
    return people[people.length - 1];
  };

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let d = new Date(start); d < today; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    if (d.getDay() === 0) continue; // closed Sundays
    const count = 12 + Math.floor(rand() * 22);
    for (let i = 0; i < count; i++) {
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9 + Math.floor(rand() * 9), Math.floor(rand() * 60));
      const device = rand() < 0.55 ? deviceId : OTHER_DEVICE;
      const participant = rand() < 0.05 ? null : pick();
      events.push(createEvent(device, visitBody(rand, participant), at));
    }
    // Mid-month restock for the other van.
    if (d.getDate() === 15) events.push(createEvent(OTHER_DEVICE, { type: 'stock.received', supply: 'naloxone_nasal', qty: 96 }, d));
  }
  // Top up anything that would have gone negative with realistic restocks,
  // then leave this phone low on nasal naloxone so the warning is visible.
  const ledger = new Ledger(events);
  const restockAt = new Date(today.getTime() - 9 * 86_400_000);
  for (const device of [deviceId, OTHER_DEVICE]) {
    const onHand = ledger.onHand(device);
    for (const [supply, qty] of Object.entries(onHand)) {
      const floor = supply === 'syringes' ? 4000 : supply.startsWith('naloxone') ? 60 : 300;
      if (qty < floor) {
        const amount = Math.ceil((floor - qty + floor) / 100) * 100;
        events.push(createEvent(device, { type: 'stock.received', supply, qty: amount }, restockAt));
      }
    }
  }
  const mine = new Ledger(events).onHand(deviceId).naloxone_nasal ?? 0;
  const target = 19;
  if (mine !== target) {
    events.push(
      createEvent(
        deviceId,
        { type: 'stock.adjusted', supply: 'naloxone_nasal', delta: target - mine, reason: 'transfer_out' },
        new Date(today.getTime() - 3 * 3_600_000),
      ),
    );
  }
  return events;
}

/** Today's visits on this phone, not yet uploaded. */
export function demoToday(keys: ProgramKeys, deviceId: string, now = new Date()): KitEvent[] {
  const rand = mulberry32(42);
  const people = ['JD03', 'MR11', 'KT07', 'AL02', 'SB09', 'TW12'].map((c) => hashCode(keys.codeKey, c));
  const events: KitEvent[] = [];
  for (let i = 0; i < people.length; i++) {
    const at = new Date(now.getTime() - (people.length - i) * 17 * 60_000);
    events.push(createEvent(deviceId, visitBody(rand, people[i]), at));
  }
  return events;
}
