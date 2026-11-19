import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { fromBase64Url, timingSafeEqual, toBase64Url, utf8 } from './bytes';
import { randomBytes } from './random';

/**
 * PIN verifiers. The PIN gates the UI; the database key itself lives in the
 * platform keystore. A verifier looks like
 *   pbkdf2-sha256:<iterations>:<salt b64url>:<hash b64url>
 */
const DEFAULT_ITERATIONS = 60_000;
const SEP = ':';

export const PIN_RE = /^\d{4,8}$/;

export async function hashPin(pin: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  if (!PIN_RE.test(pin)) throw new Error('PIN must be 4 to 8 digits');
  const salt = randomBytes(16);
  const dk = await pbkdf2Async(sha256, utf8.encode(pin), salt, { c: iterations, dkLen: 32 });
  return ['pbkdf2-sha256', String(iterations), toBase64Url(salt), toBase64Url(dk)].join(SEP);
}

export async function verifyPin(pin: string, verifier: string | null | undefined): Promise<boolean> {
  if (!verifier) return false;
  const parts = verifier.split(SEP);
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 10_000_000) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64Url(parts[2]);
    expected = fromBase64Url(parts[3]);
  } catch {
    return false;
  }
  const dk = await pbkdf2Async(sha256, utf8.encode(pin), salt, { c: iterations, dkLen: expected.length });
  return timingSafeEqual(dk, expected);
}
