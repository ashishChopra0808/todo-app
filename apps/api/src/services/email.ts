import type { FastifyBaseLogger } from 'fastify';
import { maskEmail } from '@todo/shared';
import type { Config } from '../config';
import { writeOutbox } from './outbox';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** What the email is for, used in logs (never the content). */
  purpose: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

export function createEmailSender(config: Config, log: FastifyBaseLogger): EmailSender {
  switch (config.EMAIL_DRIVER) {
    case 'resend':
      return {
        async send(msg) {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.RESEND_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: config.EMAIL_FROM,
              to: [msg.to],
              subject: msg.subject,
              text: msg.text,
              html: msg.html,
            }),
          });
          if (!res.ok) {
            log.error(
              { status: res.status, purpose: msg.purpose, to: maskEmail(msg.to) },
              'email send failed',
            );
            throw new Error(`email send failed: ${res.status}`);
          }
          log.info({ purpose: msg.purpose, to: maskEmail(msg.to) }, 'email sent');
        },
      };
    case 'file':
      return { send: (msg) => writeOutbox(config.OUTBOX_DIR, 'email', { ...msg }) };
    case 'log':
      return {
        async send(msg) {
          log.info({ purpose: msg.purpose, to: maskEmail(msg.to) }, 'email (log driver, not sent)');
        },
      };
  }
}
