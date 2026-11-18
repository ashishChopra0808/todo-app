import type { FastifyBaseLogger } from 'fastify';
import { maskPhone } from '@todo/shared';
import type { Config } from '../config';
import type { EmailSender } from './email';
import { writeOutbox } from './outbox';

export interface OtpSms {
  to: string;
  code: string;
  purpose: 'verify' | 'reset' | 'change';
  text: string;
}

export interface SmsSender {
  sendOtp(msg: OtpSms): Promise<void>;
}

/**
 * Drivers:
 * - msg91: production, once DLT registration (entity, sender ID, OTP template) is approved.
 * - forward-email: staging, until DLT approval. The SMS text is emailed to SMS_FORWARD_TO (you).
 * - file / log: dev and tests.
 */
export function createSmsSender(
  config: Config,
  log: FastifyBaseLogger,
  email: EmailSender,
): SmsSender {
  switch (config.SMS_DRIVER) {
    case 'msg91':
      return {
        async sendOtp(msg) {
          const res = await fetch('https://control.msg91.com/api/v5/flow', {
            method: 'POST',
            headers: { authkey: config.MSG91_AUTH_KEY ?? '', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              template_id: config.MSG91_OTP_TEMPLATE_ID,
              short_url: '0',
              recipients: [{ mobiles: msg.to.replace('+', ''), otp: msg.code }],
            }),
          });
          if (!res.ok) {
            log.error(
              { status: res.status, to: maskPhone(msg.to), purpose: msg.purpose },
              'sms send failed',
            );
            throw new Error(`sms send failed: ${res.status}`);
          }
          log.info({ to: maskPhone(msg.to), purpose: msg.purpose }, 'sms sent');
        },
      };
    case 'forward-email':
      return {
        async sendOtp(msg) {
          await email.send({
            to: config.SMS_FORWARD_TO ?? '',
            subject: `[Staging SMS] for ${maskPhone(msg.to)}`,
            text: `This SMS would have been sent to ${maskPhone(msg.to)}:\n\n${msg.text}`,
            purpose: `sms-forward-${msg.purpose}`,
          });
        },
      };
    case 'file':
      return { sendOtp: (msg) => writeOutbox(config.OUTBOX_DIR, 'sms', { ...msg }) };
    case 'log':
      return {
        async sendOtp(msg) {
          log.info({ to: maskPhone(msg.to), purpose: msg.purpose }, 'sms (log driver, not sent)');
        },
      };
  }
}
