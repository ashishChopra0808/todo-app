import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import type { Config } from '../config';
import { safeEqual } from '../lib/crypto';

/** Files are private. Reads go through signed URLs that expire (default 15 minutes). */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  signedUrl(key: string, ttlSeconds?: number): Promise<string>;
}

const DEFAULT_TTL = 15 * 60;

export function createStorage(
  config: Config,
): Storage & { readLocal?: (token: string) => Promise<{ body: Buffer; key: string } | null> } {
  if (config.STORAGE_DRIVER === 's3') {
    const s3 = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? '',
      },
    });
    const Bucket = config.S3_BUCKET;
    return {
      async put(key, body, contentType) {
        await s3.send(
          new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
        );
      },
      async remove(key) {
        await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
      },
      signedUrl(key, ttl = DEFAULT_TTL) {
        return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: ttl });
      },
    };
  }

  // Local driver (dev/test): files on disk, served by /api/v1/files/local/:token with an HMAC token.
  const root = config.LOCAL_STORAGE_DIR;
  const pathFor = (key: string) => {
    const p = normalize(join(root, key));
    if (!p.startsWith(normalize(root))) throw new Error('invalid key');
    return p;
  };
  const sign = (payload: string) =>
    createHmac('sha256', config.BETTER_AUTH_SECRET).update(payload).digest('base64url');
  return {
    async put(key, body) {
      const p = pathFor(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    async remove(key) {
      await rm(pathFor(key), { force: true });
    },
    async signedUrl(key, ttl = DEFAULT_TTL) {
      const payload = Buffer.from(JSON.stringify({ k: key, e: Date.now() + ttl * 1000 })).toString(
        'base64url',
      );
      return `/api/v1/files/local/${payload}.${sign(payload)}`;
    },
    async readLocal(token) {
      const [payload, sig] = token.split('.');
      if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
      const { k, e } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
        k: string;
        e: number;
      };
      if (Date.now() > e) return null;
      try {
        return { key: k, body: await readFile(pathFor(k)) };
      } catch {
        return null;
      }
    },
  };
}
