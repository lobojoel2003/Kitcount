import { CODE_HASH_RE } from '../crypto/codes';
import { UUID_RE, uuid } from '../crypto/random';
import { validateCatalog, type Catalog } from './catalog';

/**
 * Kitcount data is an append-only log of small, immutable events. Nothing is
 * ever updated in place: mistakes are corrected with a `visit.voided` event,
 * stock counts become `stock.adjusted` deltas, and settings are
 * last-writer-wins. That makes multi-device sync conflict-free.
 *
 * There are intentionally no free-text fields anywhere in the model, so staff
 * cannot accidentally type a name or other identifying detail into the record.
 */

export const EVENT_VERSION = 1;

interface BaseEvent {
  id: string;
  v: typeof EVENT_VERSION;
  /** ISO-8601 UTC timestamp from the recording device's clock. */
  at: string;
  /** Random id of the device that recorded the event. */
  device: string;
}

export interface VisitLogged extends BaseEvent {
  type: 'visit.logged';
  /** HMAC of the participant code, or null when the participant declined a code. */
  participant: string | null;
  /** Units handed out, by supply id. */
  out: Record<string, number>;
  /** Used syringes collected at this visit. */
  syringesIn: number;
  /** Overdose reversals the participant reports since their last visit. */
  reversals: number;
  /** Referral ids made at this visit. */
  referrals: string[];
  /** Number of other people this participant is picking up for (secondary distribution). */
  secondary: number;
}

export interface VisitVoided extends BaseEvent {
  type: 'visit.voided';
  visit: string;
}

export interface StockReceived extends BaseEvent {
  type: 'stock.received';
  supply: string;
  qty: number;
}

export const ADJUST_REASONS = ['count', 'expired', 'damaged', 'transfer_out', 'transfer_in', 'other'] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

export interface StockAdjusted extends BaseEvent {
  type: 'stock.adjusted';
  supply: string;
  /** Signed change in on-hand units. */
  delta: number;
  reason: AdjustReason;
}

export interface ProgramConfig {
  programName: string;
  /** Default report template id. */
  templateId: string;
  /** Shown under the code field, e.g. "First + last initial, birth month (JD03)". */
  codeHint: string;
  /** Optional regex (without anchors) that normalised codes must match. */
  codePattern: string;
  catalog: Catalog;
}

export type ConfigKey = keyof ProgramConfig;
export const CONFIG_KEYS: readonly ConfigKey[] = ['programName', 'templateId', 'codeHint', 'codePattern', 'catalog'];

export interface ConfigSet extends BaseEvent {
  type: 'config.set';
  key: ConfigKey;
  value: ProgramConfig[ConfigKey];
}

export type KitEvent = VisitLogged | VisitVoided | StockReceived | StockAdjusted | ConfigSet;
export type KitEventType = KitEvent['type'];

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type NewEvent = DistributiveOmit<KitEvent, 'id' | 'v' | 'at' | 'device'>;

export function createEvent<T extends NewEvent>(device: string, body: T, at: Date = new Date()): T & BaseEvent {
  return { ...body, id: uuid(), v: EVENT_VERSION, at: at.toISOString(), device } as T & BaseEvent;
}

// ---------------------------------------------------------------------------
// Validation of untrusted events (decrypted from sync, or read from storage)
// ---------------------------------------------------------------------------

export class EventValidationError extends Error {}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const ID_RE = /^[a-z][a-z0-9_]{0,39}$/;
const DEVICE_RE = /^[0-9a-f-]{8,64}$/;
const MAX_QTY = 100_000;

function fail(msg: string): never {
  throw new EventValidationError(msg);
}
function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateConfigValue(key: ConfigKey, value: unknown): ProgramConfig[ConfigKey] {
  switch (key) {
    case 'programName':
      if (typeof value !== 'string' || !value.trim() || value.length > 120) fail('invalid programName');
      return value.trim();
    case 'templateId':
      if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) fail('invalid templateId');
      return value;
    case 'codeHint':
      if (typeof value !== 'string' || value.length > 120) fail('invalid codeHint');
      return value;
    case 'codePattern':
      if (typeof value !== 'string' || value.length > 200) fail('invalid codePattern');
      if (value) {
        try {
          new RegExp(value);
        } catch {
          fail('codePattern is not a valid regular expression');
        }
      }
      return value;
    case 'catalog':
      try {
        return validateCatalog(value);
      } catch (e) {
        fail(`invalid catalog: ${(e as Error).message}`);
      }
  }
}

/** Parses and strictly validates an event. Unknown fields are dropped. */
export function parseEvent(input: unknown): KitEvent {
  if (!isObj(input)) fail('event must be an object');
  const { id, v, at, device, type } = input;
  if (typeof id !== 'string' || !UUID_RE.test(id)) fail('invalid id');
  if (v !== EVENT_VERSION) fail(`unsupported event version ${String(v)}`);
  if (typeof at !== 'string' || !ISO_RE.test(at) || Number.isNaN(Date.parse(at))) fail('invalid timestamp');
  if (typeof device !== 'string' || !DEVICE_RE.test(device)) fail('invalid device');
  const base = { id, v: EVENT_VERSION, at, device } as const;

  switch (type) {
    case 'visit.logged': {
      const { participant, out, syringesIn, reversals, referrals, secondary } = input;
      if (participant !== null && (typeof participant !== 'string' || !CODE_HASH_RE.test(participant))) {
        fail('invalid participant');
      }
      if (!isObj(out)) fail('invalid out');
      const cleanOut: Record<string, number> = {};
      const keys = Object.keys(out);
      if (keys.length > 60) fail('too many supplies');
      for (const k of keys) {
        if (!ID_RE.test(k)) fail(`invalid supply id ${k}`);
        const q = out[k];
        if (!isInt(q, 0, MAX_QTY)) fail(`invalid quantity for ${k}`);
        if (q > 0) cleanOut[k] = q;
      }
      if (!isInt(syringesIn, 0, MAX_QTY)) fail('invalid syringesIn');
      if (!isInt(reversals, 0, 100)) fail('invalid reversals');
      if (!isInt(secondary, 0, 100)) fail('invalid secondary');
      if (!Array.isArray(referrals) || referrals.length > 30) fail('invalid referrals');
      const refs = Array.from(new Set(referrals.map((r) => (typeof r === 'string' && ID_RE.test(r) ? r : fail('invalid referral')))));
      return { ...base, type, participant, out: cleanOut, syringesIn, reversals, referrals: refs, secondary };
    }
    case 'visit.voided': {
      const { visit } = input;
      if (typeof visit !== 'string' || !UUID_RE.test(visit)) fail('invalid visit');
      return { ...base, type, visit };
    }
    case 'stock.received': {
      const { supply, qty } = input;
      if (typeof supply !== 'string' || !ID_RE.test(supply)) fail('invalid supply');
      if (!isInt(qty, 1, 10_000_000)) fail('invalid qty');
      return { ...base, type, supply, qty };
    }
    case 'stock.adjusted': {
      const { supply, delta, reason } = input;
      if (typeof supply !== 'string' || !ID_RE.test(supply)) fail('invalid supply');
      if (!isInt(delta, -10_000_000, 10_000_000) || delta === 0) fail('invalid delta');
      if (typeof reason !== 'string' || !(ADJUST_REASONS as readonly string[]).includes(reason)) fail('invalid reason');
      return { ...base, type, supply, delta, reason: reason as AdjustReason };
    }
    case 'config.set': {
      const { key, value } = input;
      if (typeof key !== 'string' || !(CONFIG_KEYS as readonly string[]).includes(key)) fail('invalid config key');
      return { ...base, type, key: key as ConfigKey, value: validateConfigValue(key as ConfigKey, value) };
    }
    default:
      fail(`unknown event type ${String(type)}`);
  }
}

/** Total number of units handed out in a visit. */
export function visitUnits(v: VisitLogged): number {
  let n = 0;
  for (const q of Object.values(v.out)) n += q;
  return n;
}
