import { normalizePhone } from '@todo/shared';
import { get, post } from '../api/client';

export type Channel = 'email' | 'phone';

/** Thin wrappers over the auth endpoints (Better Auth under /api/auth, plus our phone sign-up). */
export const authApi = {
  publicConfig: () =>
    get<{ googleEnabled: boolean; smsToEmail?: boolean }>('/api/v1/public-config'),

  signIn: (channel: Channel, id: string, password: string) =>
    channel === 'email'
      ? post('/api/auth/sign-in/email', { email: id.trim(), password })
      : post('/api/auth/sign-in/phone-number', { phoneNumber: normalizePhone(id) ?? id, password }),

  signUpEmail: (input: {
    name: string;
    email: string;
    password: string;
    acceptTerms: boolean;
    locale: string;
    timeZone: string;
  }) => post('/api/auth/sign-up/email', input),

  signUpPhone: (input: {
    name: string;
    phoneNumber: string;
    password: string;
    acceptTerms: boolean;
    locale: string;
    timeZone: string;
  }) => post<{ phoneNumber: string }>('/api/v1/auth/phone/sign-up', input),

  sendVerification: (channel: Channel, target: string) =>
    channel === 'email'
      ? post('/api/auth/email-otp/send-verification-otp', {
          email: target,
          type: 'email-verification',
        })
      : post('/api/auth/phone-number/send-otp', { phoneNumber: target }),

  verify: (channel: Channel, target: string, code: string) =>
    channel === 'email'
      ? post('/api/auth/email-otp/verify-email', { email: target, otp: code })
      : post('/api/auth/phone-number/verify', { phoneNumber: target, code }),

  requestReset: (channel: Channel, target: string) =>
    channel === 'email'
      ? post('/api/auth/email-otp/request-password-reset', { email: target })
      : post('/api/auth/phone-number/request-password-reset', { phoneNumber: target }),

  reset: (channel: Channel, target: string, code: string, password: string) =>
    channel === 'email'
      ? post('/api/auth/email-otp/reset-password', { email: target, otp: code, password })
      : post('/api/auth/phone-number/reset-password', {
          phoneNumber: target,
          otp: code,
          newPassword: password,
        }),

  google: () =>
    post<{ url: string }>('/api/auth/sign-in/social', {
      provider: 'google',
      callbackURL: '/today',
      newUserCallbackURL: '/welcome',
      errorCallbackURL: '/sign-in?error=google',
    }),

  signOut: () => post('/api/auth/sign-out', {}),
  signOutAll: () => post('/api/auth/revoke-sessions', {}),
  changePassword: (currentPassword: string, newPassword: string) =>
    post('/api/auth/change-password', { currentPassword, newPassword, revokeOtherSessions: true }),
  requestEmailChange: (newEmail: string) =>
    post('/api/auth/email-otp/request-email-change', { newEmail }),
  confirmEmailChange: (newEmail: string, otp: string) =>
    post('/api/auth/email-otp/change-email', { newEmail, otp }),
  requestPhoneChange: (phoneNumber: string) =>
    post('/api/auth/phone-number/send-otp', { phoneNumber }),
  confirmPhoneChange: (phoneNumber: string, code: string) =>
    post('/api/auth/phone-number/verify', { phoneNumber, code, updatePhoneNumber: true }),
};

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}

/** Masks the middle of an email/phone for display on the OTP screen. */
export function displayTarget(channel: Channel, target: string) {
  if (channel === 'phone')
    return target.replace(
      /^(\+\d{2})(\d+)(\d{3})$/,
      (_, a, mid: string, b) => `${a} ${'•'.repeat(mid.length)}${b}`,
    );
  return target;
}
