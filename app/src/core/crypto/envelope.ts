import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

import { concat, fromBase64Url, toBase64Url, utf8 } from './bytes';
import { randomBytes } from './random';

/**
 * Sync envelopes: every event leaves the device as
 *   base64url( version(1) || nonce(24) || XChaCha20-Poly1305(ciphertext||tag) )
 * with associated data "kitcount/v1|<programId>|<eventId>".
 *
 * Binding the event id and program id as AAD means the server (or anyone who
 * can write to it) cannot swap ciphertexts between events or programs without
 * detection. Random 192-bit nonces are safe with XChaCha20.
 */
export const ENVELOPE_VERSION = 1;
const NONCE_LENGTH = 24;

function aad(programId: string, eventId: string): Uint8Array {
  return utf8.encode(`kitcount/v1|${programId}|${eventId}`);
}

export function seal(syncKey: Uint8Array, programId: string, eventId: string, plaintext: string): string {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = xchacha20poly1305(syncKey, nonce, aad(programId, eventId));
  const ct = cipher.encrypt(utf8.encode(plaintext));
  return toBase64Url(concat(Uint8Array.of(ENVELOPE_VERSION), nonce, ct));
}

export class EnvelopeError extends Error {}

export function open(syncKey: Uint8Array, programId: string, eventId: string, blob: string): string {
  let raw: Uint8Array;
  try {
    raw = fromBase64Url(blob);
  } catch {
    throw new EnvelopeError('Envelope is not valid base64url');
  }
  if (raw.length < 1 + NONCE_LENGTH + 16) throw new EnvelopeError('Envelope is too short');
  if (raw[0] !== ENVELOPE_VERSION) throw new EnvelopeError(`Unsupported envelope version ${raw[0]}`);
  const nonce = raw.subarray(1, 1 + NONCE_LENGTH);
  const ct = raw.subarray(1 + NONCE_LENGTH);
  try {
    const cipher = xchacha20poly1305(syncKey, nonce, aad(programId, eventId));
    return utf8.decode(cipher.decrypt(ct));
  } catch {
    throw new EnvelopeError('Envelope failed authentication (wrong program key or tampered data)');
  }
}
