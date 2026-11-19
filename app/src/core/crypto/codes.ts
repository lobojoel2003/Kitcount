import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { toHex, utf8 } from './bytes';

/**
 * Participant codes are self-chosen, low-entropy identifiers such as initials
 * plus birth month ("JD03"). They are normalised, then hashed with a keyed
 * HMAC so that:
 *  - the same person gets the same hash on every device in the program
 *    (needed for unduplicated participant counts), and
 *  - a stolen database or server dump cannot be reversed by brute-forcing the
 *    small code space without also holding the program secret.
 *
 * The plaintext code is never written to disk.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeCode(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export const MIN_CODE_LENGTH = 3;
export const MAX_CODE_LENGTH = 24;

export type CodeCheck = { ok: true; normalized: string } | { ok: false; reason: string };

export function checkCode(raw: string, pattern?: string): CodeCheck {
  const normalized = normalizeCode(raw);
  if (normalized.length < MIN_CODE_LENGTH) return { ok: false, reason: `Use at least ${MIN_CODE_LENGTH} letters or digits` };
  if (normalized.length > MAX_CODE_LENGTH) return { ok: false, reason: 'Code is too long' };
  if (pattern) {
    let re: RegExp;
    try {
      re = new RegExp(`^(?:${pattern})$`);
    } catch {
      return { ok: true, normalized };
    }
    if (!re.test(normalized)) return { ok: false, reason: "Doesn't match this program's code format" };
  }
  return { ok: true, normalized };
}

/** 128-bit truncated HMAC-SHA256, hex encoded (32 chars). */
export function hashCode(codeKey: Uint8Array, raw: string): string {
  const normalized = normalizeCode(raw);
  if (!normalized) throw new Error('Empty participant code');
  const mac = hmac(sha256, codeKey, utf8.encode(`kitcount/v1/code|${normalized}`));
  return toHex(mac.subarray(0, 16));
}

export const CODE_HASH_RE = /^[0-9a-f]{32}$/;
