import { and, eq, isNull } from 'drizzle-orm';
import { AUDIO, RETENTION_DAYS, type AudioDto, type AudioMime, type FileDto } from '@todo/shared';
import type { Db } from '../db/client';
import { files } from '../db/schema';
import { AppError } from '../lib/errors';
import { newId } from '../lib/ids';
import type { DailyLimits } from './daily-limits';
import type { Storage } from './storage';

type FileRow = typeof files.$inferSelect;
export type AudioKind = 'task_audio' | 'comment_audio';

/**
 * The real type, from the file's first bytes (never trust the browser's label):
 * WebM/Matroska 1A 45 DF A3 · MP4 "ftyp" at offset 4 · Ogg "OggS".
 */
export function sniffAudio(buf: Buffer): AudioMime | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'audio/webm';
  if (buf.toString('latin1', 4, 8) === 'ftyp') return 'audio/mp4';
  if (buf.toString('latin1', 0, 4) === 'OggS') return 'audio/ogg';
  return null;
}

const EXT: Record<AudioMime, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
};

export function createFileService(db: Db, storage: Storage, limits: DailyLimits) {
  return {
    async uploadAudio(
      ownerId: string,
      kind: AudioKind,
      buf: Buffer,
      durationMs: number | null,
    ): Promise<FileDto> {
      if (buf.length > AUDIO.maxBytes)
        throw new AppError('file_too_large', 'Recordings must be 5 MB or smaller');
      const mime = sniffAudio(buf);
      if (!mime) throw new AppError('unsupported_file', 'This is not a supported recording');
      // The browser measures the length; it's capped here too (the recorder stops at 2 min).
      if (durationMs !== null && (durationMs < 0 || durationMs > AUDIO.maxMs + 2_000))
        throw new AppError('validation_failed', 'Recordings can be up to 2 minutes', {
          fields: { durationMs: 'too_long' },
        });
      await limits.consume('voiceUploads', ownerId);
      const id = newId();
      const key = `audio/${ownerId}/${id}.${EXT[mime]}`;
      await storage.put(key, buf, mime);
      await db.insert(files).values({
        id,
        ownerId,
        kind,
        storageKey: key,
        mimeType: mime,
        sizeBytes: buf.length,
        durationMs: durationMs === null ? null : Math.round(durationMs),
        status: 'ready',
      });
      return { id, kind, mimeType: mime, sizeBytes: buf.length, durationMs };
    },

    /**
     * A recording the user uploaded and may now attach (to a task or a comment).
     * Someone else's file id, or a file of the wrong kind, is refused.
     */
    async claimable(ownerId: string, fileId: string, kind: AudioKind): Promise<FileRow> {
      const f = await db.query.files.findFirst({
        where: and(eq(files.id, fileId), eq(files.ownerId, ownerId), isNull(files.deletedAt)),
      });
      if (!f || f.kind !== kind)
        throw new AppError('validation_failed', 'Recording not found', {
          fields: { audioFileId: 'invalid' },
        });
      return f;
    },

    /** The player's data. Callers must already have checked the viewer can see the task/comment. */
    async audioDto(fileId: string | null): Promise<AudioDto | null> {
      if (!fileId) return null;
      const f = await db.query.files.findFirst({
        where: and(eq(files.id, fileId), isNull(files.deletedAt)),
      });
      if (!f) return null;
      return {
        id: f.id,
        url: await storage.signedUrl(f.storageKey),
        mimeType: f.mimeType,
        durationMs: f.durationMs,
      };
    },

    /** Hidden with its task/comment; purged with the 180-day rule. */
    async hide(fileId: string | null) {
      if (!fileId) return;
      await db
        .update(files)
        .set({
          deletedAt: new Date(),
          purgeAfter: new Date(Date.now() + RETENTION_DAYS * 864e5),
        })
        .where(and(eq(files.id, fileId), isNull(files.deletedAt)));
    },
  };
}
export type FileService = ReturnType<typeof createFileService>;
