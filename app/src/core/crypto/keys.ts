import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { fromBase64Url, toBase64Url, toHex, utf8 } from './bytes';
import { randomBytes } from './random';

/**
 * A program is one syringe services program. Every device enrolled in the
 * program holds the same 32-byte program secret. Everything else is derived
 * from it with HKDF-SHA256 using distinct, versioned labels, so a key used for
 * hashing participant codes is never reused for encryption.
 *
 * The sync server never receives the program secret.
 */
export interface ProgramKeys {
  /** Public, random program identifier (hex). Bound into every ciphertext. */
  programId: string;
  /** The root secret. Only ever stored in the encrypted database / keystore. */
  secret: Uint8Array;
  /** HMAC key for participant codes. */
  codeKey: Uint8Array;
  /** XChaCha20-Poly1305 key for sync envelopes. */
  syncKey: Uint8Array;
}

const SALT = utf8.encode('kitcount');

export function deriveProgramKeys(programId: string, secret: Uint8Array): ProgramKeys {
  if (secret.length !== 32) throw new Error('Program secret must be 32 bytes');
  if (!/^[0-9a-f]{32}$/.test(programId)) throw new Error('Program id must be 32 hex characters');
  const info = (label: string) => utf8.encode(`kitcount/v1/${label}/${programId}`);
  return {
    programId,
    secret,
    codeKey: hkdf(sha256, secret, SALT, info('participant-code'), 32),
    syncKey: hkdf(sha256, secret, SALT, info('sync-envelope'), 32),
  };
}

export function generateProgram(): { programId: string; secret: Uint8Array } {
  return { programId: toHex(randomBytes(16)), secret: randomBytes(32) };
}

/** Everything a second device needs to join a program (shown as a QR code). */
export interface Enrollment {
  programId: string;
  secret: Uint8Array;
  programName: string;
  templateId?: string;
  serverUrl?: string;
}

const ENROLL_PREFIX = 'kitcount:join:v1:';

function checksum(payload: string): string {
  return toBase64Url(sha256(utf8.encode(payload)).subarray(0, 4));
}

export function encodeEnrollment(e: Enrollment): string {
  const payload = toBase64Url(
    utf8.encode(
      JSON.stringify({
        i: e.programId,
        k: toBase64Url(e.secret),
        n: e.programName,
        ...(e.templateId ? { t: e.templateId } : {}),
        ...(e.serverUrl ? { s: e.serverUrl } : {}),
      }),
    ),
  );
  return `${ENROLL_PREFIX}${payload}.${checksum(payload)}`;
}

export function decodeEnrollment(text: string): Enrollment {
  const trimmed = text.trim();
  if (!trimmed.startsWith(ENROLL_PREFIX)) throw new Error('This is not a Kitcount enrollment code.');
  const body = trimmed.slice(ENROLL_PREFIX.length);
  const [payload, sum] = body.split('.');
  if (!payload || !sum || checksum(payload) !== sum) {
    throw new Error('The enrollment code is incomplete or was mistyped.');
  }
  let parsed: { i?: unknown; k?: unknown; n?: unknown; t?: unknown; s?: unknown };
  try {
    parsed = JSON.parse(utf8.decode(fromBase64Url(payload)));
  } catch {
    throw new Error('The enrollment code could not be read.');
  }
  if (typeof parsed.i !== 'string' || !/^[0-9a-f]{32}$/.test(parsed.i)) throw new Error('Invalid program id.');
  if (typeof parsed.k !== 'string') throw new Error('Missing program key.');
  const secret = fromBase64Url(parsed.k);
  if (secret.length !== 32) throw new Error('Invalid program key.');
  if (typeof parsed.n !== 'string' || parsed.n.length === 0 || parsed.n.length > 120) {
    throw new Error('Invalid program name.');
  }
  return {
    programId: parsed.i,
    secret,
    programName: parsed.n,
    templateId: typeof parsed.t === 'string' ? parsed.t : undefined,
    serverUrl: typeof parsed.s === 'string' ? parsed.s : undefined,
  };
}

/** Short, human-checkable fingerprint so staff can confirm two devices match. */
export function programFingerprint(keys: Pick<ProgramKeys, 'programId' | 'secret'>): string {
  const mac = hmac(sha256, keys.secret, utf8.encode(`kitcount/v1/fingerprint/${keys.programId}`));
  const hex = toHex(mac.subarray(0, 4)).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}
