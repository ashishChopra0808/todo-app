import { describe, expect, it } from 'vitest';
import { groupCreateSchema, inviteCodeSchema, inviteCreateSchema, isSingleEmoji } from './group';
import { commentCreateSchema, reportCreateSchema } from './comment';

describe('group schemas', () => {
  it('accepts one emoji as an icon, nothing else', () => {
    for (const ok of ['🏠', '👨‍👩‍👧', '🇮🇳', '❤️', '🧑🏽‍💻']) expect(isSingleEmoji(ok), ok).toBe(true);
    for (const bad of ['A', '🏠🏠', '<', '1', 'हि', '🏠a'])
      expect(isSingleEmoji(bad), bad).toBe(false);
    expect(groupCreateSchema.parse({ name: ' Home ', icon: '' })).toEqual({
      name: 'Home',
      icon: null,
    });
  });

  it('normalises invite codes', () => {
    expect(inviteCodeSchema.parse(' abcd-efgh 23 ')).toBe('ABCDEFGH23');
    expect(inviteCodeSchema.safeParse('ABCDEFGH2O').success).toBe(false); // O is not used
    expect(inviteCodeSchema.safeParse('SHORT').success).toBe(false);
  });

  it('invite channels need their target', () => {
    expect(inviteCreateSchema.safeParse({ channel: 'email' }).success).toBe(false);
    expect(inviteCreateSchema.parse({ channel: 'phone', phone: '98765 43210' })).toEqual({
      channel: 'phone',
      phone: '+919876543210',
    });
    expect(inviteCreateSchema.safeParse({ channel: 'link', email: 'a@b.co' }).success).toBe(false);
  });

  it('comments and reports', () => {
    expect(commentCreateSchema.parse({ body: ' hi\u0000 ' }).body).toBe('hi');
    expect(commentCreateSchema.safeParse({ body: '' }).success).toBe(false);
    expect(
      reportCreateSchema.parse({
        targetType: 'comment',
        targetId: '01933b6e-6a1c-7c4e-9a3f-1234567890ab',
        reason: 'spam',
        details: '  ',
      }).details,
    ).toBeNull();
  });
});
