/**
 * Cryptographically secure randomness with a pluggable source.
 *
 * React Native does not guarantee `crypto.getRandomValues`, so the app installs
 * expo-crypto's CSPRNG at startup (see src/platform/random.ts). Tests use Node's
 * WebCrypto. There is deliberately no Math.random fallback.
 */
export type RandomSource = (length: number) => Uint8Array;

let source: RandomSource | null = null;

export function setRandomSource(fn: RandomSource): void {
  source = fn;
}

export function randomBytes(length: number): Uint8Array {
  if (source) {
    const bytes = source(length);
    if (bytes.length !== length) throw new Error('Random source returned the wrong length');
    return bytes;
  }
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (webCrypto?.getRandomValues) {
    return webCrypto.getRandomValues(new Uint8Array(length));
  }
  throw new Error('No secure random source available');
}

/** RFC 4122 version 4 UUID. */
export function uuid(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
