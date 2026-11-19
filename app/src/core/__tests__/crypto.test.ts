import { concat, fromBase64Url, fromHex, timingSafeEqual, toBase64Url, toHex, utf8 } from '../crypto/bytes';
import { checkCode, hashCode, normalizeCode } from '../crypto/codes';
import { EnvelopeError, open, seal } from '../crypto/envelope';
import { decodeEnrollment, deriveProgramKeys, encodeEnrollment, generateProgram, programFingerprint } from '../crypto/keys';
import { hashPin, verifyPin } from '../crypto/pin';
import { randomBytes, setRandomSource, UUID_RE, uuid } from '../crypto/random';

const program = () => {
  const { programId, secret } = generateProgram();
  return deriveProgramKeys(programId, secret);
};

describe('bytes', () => {
  it('round-trips base64url for every length and matches Node', () => {
    for (let len = 0; len < 70; len++) {
      const bytes = randomBytes(len);
      const encoded = toBase64Url(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString('base64url'));
      expect(Array.from(fromBase64Url(encoded))).toEqual(Array.from(bytes));
    }
  });

  it('accepts standard base64 alphabet and padding', () => {
    const bytes = Uint8Array.from([251, 255, 191, 0, 1]);
    expect(Array.from(fromBase64Url(Buffer.from(bytes).toString('base64')))).toEqual(Array.from(bytes));
  });

  it('rejects invalid base64', () => {
    expect(() => fromBase64Url('a')).toThrow();
    expect(() => fromBase64Url('ab$d')).toThrow();
  });

  it('round-trips hex and rejects bad hex', () => {
    const b = randomBytes(33);
    expect(Array.from(fromHex(toHex(b)))).toEqual(Array.from(b));
    expect(() => fromHex('abc')).toThrow();
    expect(() => fromHex('zz')).toThrow();
  });

  it('concatenates and compares', () => {
    const a = utf8.encode('kit');
    const b = utf8.encode('count');
    expect(utf8.decode(concat(a, b))).toBe('kitcount');
    expect(timingSafeEqual(a, utf8.encode('kit'))).toBe(true);
    expect(timingSafeEqual(a, utf8.encode('kip'))).toBe(false);
    expect(timingSafeEqual(a, b)).toBe(false);
  });
});

describe('random', () => {
  it('produces v4 uuids', () => {
    const ids = new Set(Array.from({ length: 200 }, uuid));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_RE);
  });

  it('rejects a broken random source', () => {
    setRandomSource(() => new Uint8Array(1));
    expect(() => randomBytes(4)).toThrow('wrong length');
    // restore
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { webcrypto } = require('node:crypto');
    setRandomSource((n) => webcrypto.getRandomValues(new Uint8Array(n)));
  });
});

describe('participant codes', () => {
  it('normalises case, spacing, punctuation and accents', () => {
    expect(normalizeCode(' jd-03 ')).toBe('JD03');
    expect(normalizeCode('Jé d 0 3')).toBe('JED03');
    expect(normalizeCode('ÅB.12')).toBe('AB12');
  });

  it('checks length and optional pattern', () => {
    expect(checkCode('jd')).toEqual({ ok: false, reason: expect.stringContaining('at least') });
    expect(checkCode('x'.repeat(30))).toEqual({ ok: false, reason: 'Code is too long' });
    expect(checkCode('jd03', '[A-Z]{2}\\d{2}')).toEqual({ ok: true, normalized: 'JD03' });
    expect(checkCode('jdx3', '[A-Z]{2}\\d{2}').ok).toBe(false);
    // An invalid pattern never blocks staff in the field.
    expect(checkCode('jd03', '([').ok).toBe(true);
  });

  it('hashes deterministically per program and differently across programs', () => {
    const a = program();
    const b = program();
    const h1 = hashCode(a.codeKey, 'JD03');
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
    expect(hashCode(a.codeKey, 'jd-03')).toBe(h1);
    expect(hashCode(b.codeKey, 'JD03')).not.toBe(h1);
    expect(hashCode(a.codeKey, 'JD04')).not.toBe(h1);
    expect(() => hashCode(a.codeKey, '--')).toThrow();
  });

  it('never contains the plaintext code', () => {
    const k = program();
    expect(hashCode(k.codeKey, 'AB12')).not.toContain('AB12');
  });
});

describe('program keys and enrollment', () => {
  it('derives distinct sub-keys', () => {
    const k = program();
    expect(toHex(k.codeKey)).not.toBe(toHex(k.syncKey));
    expect(k.codeKey).toHaveLength(32);
    const again = deriveProgramKeys(k.programId, k.secret);
    expect(toHex(again.syncKey)).toBe(toHex(k.syncKey));
  });

  it('validates inputs', () => {
    expect(() => deriveProgramKeys('nothex', randomBytes(32))).toThrow();
    expect(() => deriveProgramKeys('0'.repeat(32), randomBytes(16))).toThrow();
  });

  it('round-trips an enrollment code', () => {
    const { programId, secret } = generateProgram();
    const code = encodeEnrollment({ programId, secret, programName: 'Harbor Harm Reduction', templateId: 'generic-monthly', serverUrl: 'https://sync.example.org' });
    expect(code.startsWith('kitcount:join:v1:')).toBe(true);
    const back = decodeEnrollment(`  ${code}\n`);
    expect(back.programId).toBe(programId);
    expect(toHex(back.secret)).toBe(toHex(secret));
    expect(back.programName).toBe('Harbor Harm Reduction');
    expect(back.templateId).toBe('generic-monthly');
    expect(back.serverUrl).toBe('https://sync.example.org');
  });

  it('detects typos and foreign codes', () => {
    const { programId, secret } = generateProgram();
    const code = encodeEnrollment({ programId, secret, programName: 'X' });
    const tampered = code.slice(0, 30) + (code[30] === 'A' ? 'B' : 'A') + code.slice(31);
    expect(() => decodeEnrollment(tampered)).toThrow(/mistyped/);
    expect(() => decodeEnrollment('hello')).toThrow(/not a Kitcount/);
    expect(() => decodeEnrollment('kitcount:join:v1:abc')).toThrow(/incomplete/);
  });

  it('rejects structurally bad payloads with a valid checksum', () => {
    const make = (obj: unknown) => {
      const payload = toBase64Url(utf8.encode(JSON.stringify(obj)));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { sha256 } = require('@noble/hashes/sha2.js');
      return `kitcount:join:v1:${payload}.${toBase64Url(sha256(utf8.encode(payload)).subarray(0, 4))}`;
    };
    const id = '0'.repeat(32);
    const k = toBase64Url(randomBytes(32));
    expect(() => decodeEnrollment(make({ i: 'x', k, n: 'P' }))).toThrow(/program id/);
    expect(() => decodeEnrollment(make({ i: id, n: 'P' }))).toThrow(/Missing/);
    expect(() => decodeEnrollment(make({ i: id, k: toBase64Url(randomBytes(8)), n: 'P' }))).toThrow(/key/);
    expect(() => decodeEnrollment(make({ i: id, k, n: '' }))).toThrow(/name/);
    expect(decodeEnrollment(make({ i: id, k, n: 'P' })).programName).toBe('P');
  });

  it('produces a stable fingerprint', () => {
    const k = program();
    expect(programFingerprint(k)).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(programFingerprint(k)).toBe(programFingerprint(k));
  });
});

describe('sync envelopes', () => {
  it('seals and opens', () => {
    const k = program();
    const blob = seal(k.syncKey, k.programId, 'evt-1', '{"hello":"world"}');
    expect(blob).not.toContain('hello');
    expect(open(k.syncKey, k.programId, 'evt-1', blob)).toBe('{"hello":"world"}');
  });

  it('uses a fresh nonce every time', () => {
    const k = program();
    expect(seal(k.syncKey, k.programId, 'e', 'x')).not.toBe(seal(k.syncKey, k.programId, 'e', 'x'));
  });

  it('binds the event id and program id', () => {
    const k = program();
    const other = program();
    const blob = seal(k.syncKey, k.programId, 'evt-1', 'payload');
    expect(() => open(k.syncKey, k.programId, 'evt-2', blob)).toThrow(EnvelopeError);
    expect(() => open(k.syncKey, other.programId, 'evt-1', blob)).toThrow(EnvelopeError);
    expect(() => open(other.syncKey, k.programId, 'evt-1', blob)).toThrow(EnvelopeError);
  });

  it('detects tampering and malformed input', () => {
    const k = program();
    const raw = fromBase64Url(seal(k.syncKey, k.programId, 'e', 'payload'));
    raw[raw.length - 1] ^= 1;
    expect(() => open(k.syncKey, k.programId, 'e', toBase64Url(raw))).toThrow(/authentication/);
    raw[0] = 9;
    expect(() => open(k.syncKey, k.programId, 'e', toBase64Url(raw))).toThrow(/version/);
    expect(() => open(k.syncKey, k.programId, 'e', 'AAAA')).toThrow(/short/);
    expect(() => open(k.syncKey, k.programId, 'e', '***')).toThrow(/base64/);
  });
});

describe('PIN verifiers', () => {
  it('verifies the right PIN only', async () => {
    const v = await hashPin('482915', 2000);
    expect(v.startsWith('pbkdf2-sha256:2000:')).toBe(true);
    await expect(verifyPin('482915', v)).resolves.toBe(true);
    await expect(verifyPin('482916', v)).resolves.toBe(false);
  });

  it('rejects malformed PINs and verifiers', async () => {
    await expect(hashPin('12')).rejects.toThrow();
    await expect(hashPin('abcd')).rejects.toThrow();
    await expect(verifyPin('1234', null)).resolves.toBe(false);
    await expect(verifyPin('1234', 'md5:1:2:3')).resolves.toBe(false);
    await expect(verifyPin('1234', 'pbkdf2-sha256:5:AA:AA')).resolves.toBe(false);
    await expect(verifyPin('1234', 'pbkdf2-sha256:5000:$$:AA')).resolves.toBe(false);
  });
});
