import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ProblemException } from '@jobpilot/kit';

export const SECRET_BOX = 'JOBPILOT_SECRET_BOX';

const keyId = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 8);

function parseKey(raw: string, name: string): Buffer {
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32)
    throw new Error(`${name} must be 32 random bytes, base64 encoded (openssl rand -base64 32)`);
  return key;
}

/**
 * Encrypts small secrets at rest (AES-256-GCM). Each value is bound to a context string, so a
 * ciphertext copied to another row, user or organization does not decrypt. The key comes from the
 * environment; a previous key can stay configured while values are re-encrypted after a rotation
 * (the key's id is stored with each value, so the right one is chosen).
 *
 * Without a key nothing is stored: callers get a clear 503 instead of a silent plaintext fallback.
 */
export class SecretBox {
  private readonly keys = new Map<string, Buffer>();
  private readonly current: { id: string; key: Buffer } | undefined;

  constructor(currentKey?: string, previousKey?: string) {
    if (currentKey) {
      const key = parseKey(currentKey, 'SECRETS_KEY');
      this.current = { id: keyId(key), key };
      this.keys.set(this.current.id, key);
    }
    if (previousKey) {
      const key = parseKey(previousKey, 'SECRETS_KEY_PREVIOUS');
      this.keys.set(keyId(key), key);
    }
  }

  get configured(): boolean {
    return this.current !== undefined;
  }

  private requireKey() {
    if (!this.current) {
      throw new ProblemException(
        503,
        'secrets-not-configured',
        'Encrypted storage is not set up on this server',
        'The administrator must set SECRETS_KEY before secrets or two-factor sign-in can be stored.',
      );
    }
    return this.current;
  }

  encrypt(plain: string, context: string): string {
    const { id, key } = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [
      id,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      body.toString('base64url'),
    ].join('.');
  }

  /** Throws when the value was changed, belongs to another context, or was made with a key no longer configured. */
  decrypt(blob: string, context: string): string {
    const [id, iv, tag, body] = blob.split('.');
    const key = id ? this.keys.get(id) : undefined;
    if (!key || !iv || !tag || !body)
      throw new Error('The stored secret cannot be read with the configured keys');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** True when the value was made with an older key and should be written again with the current one. */
  needsRotation(blob: string): boolean {
    return this.current !== undefined && blob.split('.')[0] !== this.current.id;
  }
}
