import 'server-only';
import type { Mail, MailProvider, MailResult } from './types';

/**
 * ============================================================================
 *  TO ACTUALLY SEND MAIL, SET THE ENV VARS. NO CODE CHANGE NEEDED.
 * ============================================================================
 *
 *   CHIEFOS_MAIL_PROVIDER=resend        (or "brevo")
 *   CHIEFOS_MAIL_API_KEY=...
 *   CHIEFOS_MAIL_FROM="ChiefOS <chief@yourdomain.com>"
 *   CHIEFOS_APP_URL=https://...         (the link in the email)
 *
 * Both providers are plain HTTPS JSON, so there is no dependency to add. Free
 * tiers at the time of writing: Resend 3,000/month (100/day), Brevo 300/day.
 * One person getting a morning digest is about 20 a month, so the tier is
 * irrelevant - pick on deliverability, not volume.
 *
 * DELIVERABILITY IS THE REAL WORK, NOT THIS FILE. Sending as your own domain
 * without SPF and DKIM records lands the digest in spam, which is worse than
 * not sending it: nobody notices it is broken. Verify the domain with the
 * provider first, then send.
 */

const PROVIDER = process.env.CHIEFOS_MAIL_PROVIDER ?? '';
const API_KEY = process.env.CHIEFOS_MAIL_API_KEY ?? '';
const FROM = process.env.CHIEFOS_MAIL_FROM ?? '';

export function appUrl(): string {
  return process.env.CHIEFOS_APP_URL ?? 'http://localhost:3000';
}

/** The default. Composes and returns, sends nothing. */
const noopProvider: MailProvider = {
  id: 'none',
  label: 'Not configured',
  configured: false,
  async send(): Promise<MailResult> {
    return {
      ok: false,
      message: 'No mail provider configured. Set CHIEFOS_MAIL_PROVIDER, CHIEFOS_MAIL_API_KEY and CHIEFOS_MAIL_FROM.',
    };
  },
};

const resendProvider: MailProvider = {
  id: 'resend',
  label: 'Resend',
  configured: Boolean(API_KEY && FROM),
  async send(mail: Mail): Promise<MailResult> {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        }),
      });

      const body = (await res.json()) as { id?: string; message?: string };
      if (!res.ok) return { ok: false, message: body.message ?? `Resend returned ${res.status}` };
      return { ok: true, message: 'Sent.', id: body.id };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};

const brevoProvider: MailProvider = {
  id: 'brevo',
  label: 'Brevo',
  configured: Boolean(API_KEY && FROM),
  async send(mail: Mail): Promise<MailResult> {
    // Brevo wants the sender split into name and address.
    const match = FROM.match(/^\s*(.*?)\s*<(.+)>\s*$/);
    const sender = match ? { name: match[1], email: match[2] } : { email: FROM };

    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender,
          to: [{ email: mail.to }],
          subject: mail.subject,
          textContent: mail.text,
          htmlContent: mail.html,
        }),
      });

      const body = (await res.json()) as { messageId?: string; message?: string };
      if (!res.ok) return { ok: false, message: body.message ?? `Brevo returned ${res.status}` };
      return { ok: true, message: 'Sent.', id: body.messageId };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};

export function getMailProvider(): MailProvider {
  if (PROVIDER === 'resend' && resendProvider.configured) return resendProvider;
  if (PROVIDER === 'brevo' && brevoProvider.configured) return brevoProvider;
  return noopProvider;
}

export function mailStatus(): { label: string; configured: boolean } {
  const provider = getMailProvider();
  return { label: provider.label, configured: provider.configured };
}
