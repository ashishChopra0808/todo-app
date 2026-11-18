import { describe, expect, it } from 'vitest';
import { checkPassword } from './password';
import { maskEmail, maskPhone } from './text';
import {
  emailSchema,
  phoneSchema,
  phoneSignUpSchema,
  profileUpdateSchema,
  taskCreateSchema,
  taskListQuerySchema,
} from './index';

describe('schemas', () => {
  it('normalises phone numbers to E.164 with India as default', () => {
    expect(phoneSchema.parse('98765 43210')).toBe('+919876543210');
    expect(phoneSchema.parse('+1 415 555 2671')).toBe('+14155552671');
    expect(phoneSchema.safeParse('12345').success).toBe(false);
  });

  it('lowercases emails', () => {
    expect(emailSchema.parse('  Asha@Example.COM ')).toBe('asha@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });

  it('requires consent at phone sign-up', () => {
    const base = { name: 'Asha', phoneNumber: '9876543210', password: 'x'.repeat(10) };
    expect(phoneSignUpSchema.safeParse(base).success).toBe(false);
    expect(phoneSignUpSchema.safeParse({ ...base, acceptTerms: true }).success).toBe(true);
  });

  it('cleans task text and applies defaults', () => {
    const t = taskCreateSchema.parse({ title: '  Buy \u0007milk\n  today ', description: '   ' });
    expect(t.title).toBe('Buy milk today');
    expect(t.description).toBeNull();
    expect(t.priority).toBe('medium');
    expect(t.status).toBe('todo');
    expect(taskCreateSchema.safeParse({ title: '' }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: 'x'.repeat(201) }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: 'a', createdBy: 'hacker' }).success).toBe(false);
  });

  it('parses list filters from query strings', () => {
    const q = taskListQuerySchema.parse({ view: 'today', status: 'todo,in_progress', limit: '20' });
    expect(q.status).toEqual(['todo', 'in_progress']);
    expect(q.limit).toBe(20);
    expect(taskListQuerySchema.safeParse({ status: 'nope' }).success).toBe(false);
  });

  it('validates profile time zones and rejects unknown fields', () => {
    expect(profileUpdateSchema.safeParse({ timeZone: 'Asia/Kolkata' }).success).toBe(true);
    expect(profileUpdateSchema.safeParse({ timeZone: 'Mars/Base' }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ email: 'x@y.z' }).success).toBe(false);
  });
});

describe('password policy', () => {
  it('rejects short and common passwords, accepts strong ones', async () => {
    expect((await checkPassword('short')).problem).toBe('too_short');
    expect((await checkPassword('password123')).ok).toBe(false);
    expect((await checkPassword('asha2026!', ['asha'])).ok).toBe(false);
    expect((await checkPassword('mango-river-lamp-91')).ok).toBe(true);
  });
});

describe('masking', () => {
  it('masks emails and phones for logs', () => {
    expect(maskEmail('asha@example.com')).toBe('a***@example.com');
    expect(maskPhone('+919876543210')).toBe('+91********10');
  });
});
