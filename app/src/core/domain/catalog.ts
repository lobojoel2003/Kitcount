/**
 * The supply and referral catalog. Programs can rename, reorder, disable and
 * re-threshold items; ids are stable and are what report templates refer to.
 */

export const SUPPLY_ICONS = [
  'needle',
  'naloxone',
  'strip',
  'cooker',
  'cotton',
  'water',
  'pad',
  'tourniquet',
  'sharps',
  'wound',
  'pipe',
  'condom',
  'hygiene',
  'food',
  'box',
] as const;

export type SupplyIcon = (typeof SUPPLY_ICONS)[number];

export interface Supply {
  id: string;
  name: string;
  /** Short label for the tile. */
  short: string;
  icon: SupplyIcon;
  /** How many units one tap adds (syringes are often handed out in 10s). */
  step: number;
  unit: string;
  /** Warn when this device's on-hand stock falls to this level or below. */
  lowAt: number;
  /** Life-saving supplies (naloxone) get louder, earlier warnings. */
  critical?: boolean;
  enabled: boolean;
}

export interface Referral {
  id: string;
  name: string;
  enabled: boolean;
}

export interface Catalog {
  supplies: Supply[];
  referrals: Referral[];
}

export const DEFAULT_SUPPLIES: readonly Supply[] = [
  { id: 'syringes', name: 'Syringes', short: 'Syringes', icon: 'needle', step: 10, unit: 'syringes', lowAt: 500, enabled: true },
  { id: 'naloxone_nasal', name: 'Naloxone nasal spray kit', short: 'Narcan', icon: 'naloxone', step: 1, unit: 'kits', lowAt: 24, critical: true, enabled: true },
  { id: 'naloxone_im', name: 'Naloxone IM kit', short: 'Nalox IM', icon: 'naloxone', step: 1, unit: 'kits', lowAt: 12, critical: true, enabled: true },
  { id: 'fentanyl_strips', name: 'Fentanyl test strips', short: 'FTS', icon: 'strip', step: 5, unit: 'strips', lowAt: 100, enabled: true },
  { id: 'xylazine_strips', name: 'Xylazine test strips', short: 'XTS', icon: 'strip', step: 5, unit: 'strips', lowAt: 50, enabled: true },
  { id: 'cookers', name: 'Cookers', short: 'Cookers', icon: 'cooker', step: 5, unit: 'cookers', lowAt: 100, enabled: true },
  { id: 'cottons', name: 'Cottons / filters', short: 'Cottons', icon: 'cotton', step: 10, unit: 'filters', lowAt: 200, enabled: true },
  { id: 'sterile_water', name: 'Sterile water', short: 'Water', icon: 'water', step: 5, unit: 'vials', lowAt: 100, enabled: true },
  { id: 'alcohol_pads', name: 'Alcohol pads', short: 'Pads', icon: 'pad', step: 10, unit: 'pads', lowAt: 200, enabled: true },
  { id: 'tourniquets', name: 'Tourniquets', short: 'Ties', icon: 'tourniquet', step: 1, unit: 'tourniquets', lowAt: 20, enabled: true },
  { id: 'sharps_containers', name: 'Sharps containers', short: 'Sharps', icon: 'sharps', step: 1, unit: 'containers', lowAt: 10, enabled: true },
  { id: 'wound_care', name: 'Wound care kits', short: 'Wound', icon: 'wound', step: 1, unit: 'kits', lowAt: 10, enabled: true },
  { id: 'smoking_kits', name: 'Safer smoking kits', short: 'Smoking', icon: 'pipe', step: 1, unit: 'kits', lowAt: 20, enabled: true },
  { id: 'condoms', name: 'Condoms', short: 'Condoms', icon: 'condom', step: 5, unit: 'condoms', lowAt: 100, enabled: true },
  { id: 'hygiene_kits', name: 'Hygiene kits', short: 'Hygiene', icon: 'hygiene', step: 1, unit: 'kits', lowAt: 10, enabled: false },
];

export const DEFAULT_REFERRALS: readonly Referral[] = [
  { id: 'moud', name: 'MOUD (buprenorphine / methadone)', enabled: true },
  { id: 'sud_treatment', name: 'Substance use treatment', enabled: true },
  { id: 'hiv_testing', name: 'HIV testing', enabled: true },
  { id: 'hcv_testing', name: 'Hepatitis C testing', enabled: true },
  { id: 'prep', name: 'PrEP', enabled: true },
  { id: 'medical', name: 'Medical / wound care', enabled: true },
  { id: 'mental_health', name: 'Mental health', enabled: true },
  { id: 'housing', name: 'Housing / shelter', enabled: true },
  { id: 'benefits', name: 'Insurance / benefits', enabled: true },
  { id: 'vaccination', name: 'Vaccination', enabled: false },
];

export function defaultCatalog(): Catalog {
  return {
    supplies: DEFAULT_SUPPLIES.map((s) => ({ ...s })),
    referrals: DEFAULT_REFERRALS.map((r) => ({ ...r })),
  };
}

const ID_RE = /^[a-z][a-z0-9_]{0,39}$/;

function text(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}
function int(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

/** Validates an untrusted catalog (e.g. from a synced event). Throws on error. */
export function validateCatalog(input: unknown): Catalog {
  if (!input || typeof input !== 'object') throw new Error('catalog must be an object');
  const c = input as { supplies?: unknown; referrals?: unknown };
  if (!Array.isArray(c.supplies) || c.supplies.length === 0 || c.supplies.length > 60) {
    throw new Error('catalog.supplies must be a non-empty list of at most 60 items');
  }
  if (!Array.isArray(c.referrals) || c.referrals.length > 60) {
    throw new Error('catalog.referrals must be a list of at most 60 items');
  }
  const seen = new Set<string>();
  const supplies = c.supplies.map((raw, i): Supply => {
    const s = (raw ?? {}) as Partial<Supply>;
    if (!text(s.id, 40) || !ID_RE.test(s.id)) throw new Error(`supply ${i}: invalid id`);
    if (seen.has(s.id)) throw new Error(`supply ${s.id}: duplicate id`);
    seen.add(s.id);
    if (!text(s.name, 80) || !text(s.short, 16) || !text(s.unit, 24)) throw new Error(`supply ${s.id}: invalid text`);
    if (!s.icon || !(SUPPLY_ICONS as readonly string[]).includes(s.icon)) throw new Error(`supply ${s.id}: invalid icon`);
    if (!int(s.step, 1, 1000) || !int(s.lowAt, 0, 1_000_000)) throw new Error(`supply ${s.id}: invalid numbers`);
    return {
      id: s.id,
      name: s.name.trim(),
      short: s.short.trim(),
      icon: s.icon,
      step: s.step,
      unit: s.unit.trim(),
      lowAt: s.lowAt,
      ...(s.critical === true ? { critical: true } : {}),
      enabled: s.enabled !== false,
    };
  });
  const rseen = new Set<string>();
  const referrals = c.referrals.map((raw, i): Referral => {
    const r = (raw ?? {}) as Partial<Referral>;
    if (!text(r.id, 40) || !ID_RE.test(r.id)) throw new Error(`referral ${i}: invalid id`);
    if (rseen.has(r.id)) throw new Error(`referral ${r.id}: duplicate id`);
    rseen.add(r.id);
    if (!text(r.name, 80)) throw new Error(`referral ${r.id}: invalid name`);
    return { id: r.id, name: r.name.trim(), enabled: r.enabled !== false };
  });
  return { supplies, referrals };
}
