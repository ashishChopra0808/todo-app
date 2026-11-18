import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export function createCrypto(opts: { encryptionKeyBase64: string; ipSalt: string }) {
  const key = Buffer.from(opts.encryptionKeyBase64, 'base64');
  return {
    /** AES-256-GCM. Output: base64(iv | tag | ciphertext) */
    encrypt(plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
    },
    decrypt(payload: string): string {
      const buf = Buffer.from(payload, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
      decipher.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
    },
    /** One-way hash so audit logs can correlate IPs without storing them. */
    hashIp(ip: string | null | undefined): string | null {
      if (!ip) return null;
      return createHmac('sha256', opts.ipSalt).update(ip).digest('hex').slice(0, 32);
    },
  };
}
export type CryptoKit = ReturnType<typeof createCrypto>;

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
