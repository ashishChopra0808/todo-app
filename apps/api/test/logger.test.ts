import { describe, expect, it } from 'vitest';
import { safeUrl } from '../src/lib/logger';

describe('logged addresses', () => {
  it('hide invite codes, signed file links and secret query values', () => {
    expect(safeUrl('/api/v1/invites/JU2MG3T8HP')).toBe('/api/v1/invites/[redacted]');
    expect(safeUrl('/api/v1/invites/JU2MG3T8HP/accept')).toBe('/api/v1/invites/[redacted]/accept');
    expect(safeUrl('/api/v1/files/local/eyJrIjoi?x=1')).toBe('/api/v1/files/local/[redacted]?x=1');
    expect(safeUrl('/api/auth/callback/google?code=abc&state=xyz')).toBe(
      '/api/auth/callback/google?code=[redacted]&state=[redacted]',
    );
    expect(safeUrl('/api/v1/tasks?view=mine')).toBe('/api/v1/tasks?view=mine');
  });
});
