import { describe, expect, it } from 'vitest';
import { SecretBox } from '../secrets/secret-box.js';
import { base32Decode, base32Encode, codeAt, otpauthUrl, stepOf, verifyCode } from './totp.js';

// RFC 6238, appendix B: the SHA-1 secret is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('time-based one-time passwords', () => {
  it('matches the published RFC 6238 test vectors (last six digits of the 8-digit values)', () => {
    const vectors: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ];
    for (const [seconds, expected] of vectors) {
      expect(codeAt(RFC_SECRET, stepOf(seconds * 1000))).toBe(expected);
    }
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(() => base32Decode('not valid 1!')).toThrow();
  });

  it('accepts the current code and one step of drift either way, and nothing else', () => {
    const at = 1_700_000_000_000;
    const step = stepOf(at);
    expect(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, step), at, null)).toBe(step);
    expect(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, step - 1), at, null)).toBe(step - 1);
    expect(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, step + 1), at, null)).toBe(step + 1);
    expect(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, step - 2), at, null)).toBeNull();
    expect(verifyCode(RFC_SECRET, '12345', at, null)).toBeNull();
    expect(verifyCode(RFC_SECRET, 'abcdef', at, null)).toBeNull();
  });

  it('refuses a code whose step was already used, and any older step', () => {
    const at = 1_700_000_000_000;
    const step = stepOf(at);
    const code = codeAt(RFC_SECRET, step);
    expect(verifyCode(RFC_SECRET, code, at, step)).toBeNull();
    expect(verifyCode(RFC_SECRET, codeAt(RFC_SECRET, step - 1), at, step)).toBeNull();
  });

  it('builds the address an authenticator app scans', () => {
    const url = otpauthUrl('ABCDEFGH', 'ana@example.test', 'JobPilot');
    expect(url).toContain('otpauth://totp/JobPilot%3Aana%40example.test');
    expect(url).toContain('secret=ABCDEFGH');
    expect(url).toContain('issuer=JobPilot');
  });
});

describe('the secret box', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const other = Buffer.alloc(32, 9).toString('base64');

  it('encrypts, decrypts, and never stores the plain text', () => {
    const box = new SecretBox(key);
    const blob = box.encrypt('sk-very-secret', 'org:1:anthropic');
    expect(blob).not.toContain('sk-very-secret');
    expect(box.decrypt(blob, 'org:1:anthropic')).toBe('sk-very-secret');
    expect(box.encrypt('sk-very-secret', 'org:1:anthropic')).not.toBe(blob);
  });

  it('refuses a value moved to another context or tampered with', () => {
    const box = new SecretBox(key);
    const blob = box.encrypt('value', 'user:a');
    expect(() => box.decrypt(blob, 'user:b')).toThrow();
    const parts = blob.split('.');
    parts[3] = Buffer.from('forged').toString('base64url');
    expect(() => box.decrypt(parts.join('.'), 'user:a')).toThrow();
  });

  it('reads values made with a previous key and flags them for re-encryption', () => {
    const old = new SecretBox(other);
    const blob = old.encrypt('value', 'ctx');
    const rotated = new SecretBox(key, other);
    expect(rotated.decrypt(blob, 'ctx')).toBe('value');
    expect(rotated.needsRotation(blob)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt('value', 'ctx'))).toBe(false);
    expect(() => new SecretBox(key).decrypt(blob, 'ctx')).toThrow();
  });

  it('says so, with a 503, when no key is configured', () => {
    const box = new SecretBox();
    expect(box.configured).toBe(false);
    expect(() => box.encrypt('x', 'c')).toThrowError(/SECRETS_KEY/);
  });

  it('rejects a key of the wrong length at boot', () => {
    expect(() => new SecretBox('c2hvcnQ=')).toThrow(/32 random bytes/);
  });
});
