import nodemailer, { type Transporter } from 'nodemailer';
import type { Mail, MailProvider, MailResult } from './types';

/**
 * Sending through Gmail SMTP with an app password.
 *
 * Chosen over Resend or Brevo for one reason that matters more than the API
 * ergonomics: the mail goes out through Google, so Google's own SPF and DKIM
 * apply. There is no domain to verify and no DNS record to add, which removes
 * the single most common way a digest ends up in spam - silently, where nobody
 * notices it is broken.
 *
 * The cost is a real dependency (nodemailer) and Gmail's own limits:
 * roughly 500 recipients a day on a personal account, 2,000 on Workspace.
 * One digest and a handful of reminders is nowhere near either.
 *
 * An app password is required - Google removed plain password sign-in in 2022,
 * and app passwords only appear once 2-Step Verification is on. OAuth2 is the
 * better choice for a product; for one internal tool sending to its own owner,
 * an app password is the proportionate one.
 */

const USER = process.env.CHIEFOS_GMAIL_USER ?? '';
const APP_PASSWORD = (process.env.CHIEFOS_GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, '');
const FROM = process.env.CHIEFOS_MAIL_FROM || (USER ? `ChiefOS <${USER}>` : '');

// Reused across requests; Next re-evaluates modules on hot reload, so this is
// cached on globalThis the same way the database handle is.
const globalForMail = globalThis as unknown as {
  __chiefosMailer?: Transporter;
};

function transporter(): Transporter {
  if (!globalForMail.__chiefosMailer) {
    globalForMail.__chiefosMailer = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // STARTTLS upgrades the connection; 465 would be secure: true
      auth: { user: USER, pass: APP_PASSWORD },
    });
  }
  return globalForMail.__chiefosMailer;
}

export const gmailProvider: MailProvider = {
  id: 'gmail',
  label: USER ? `Gmail (${USER})` : 'Gmail',
  configured: Boolean(USER && APP_PASSWORD),

  async send(mail: Mail): Promise<MailResult> {
    try {
      const info = await transporter().sendMail({
        from: FROM,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      return { ok: true, message: 'Sent.', id: info.messageId };
    } catch (err) {
      const message = (err as Error).message;

      // The two failures worth naming, because the raw SMTP text does not
      // tell you what to actually do about them.
      if (/Invalid login|Username and Password not accepted|BadCredentials/i.test(message)) {
        return {
          ok: false,
          message:
            'Gmail rejected the credentials. Check that 2-Step Verification is on and that ' +
            'CHIEFOS_GMAIL_APP_PASSWORD is a 16-character app password, not your account password.',
        };
      }
      if (/Daily user sending (quota|limit)|limit exceeded/i.test(message)) {
        return { ok: false, message: 'Gmail daily sending limit reached. Try again tomorrow.' };
      }
      return { ok: false, message };
    }
  },
};

/** Proves the credentials without sending anything. */
export async function verifyGmail(): Promise<MailResult> {
  if (!gmailProvider.configured) {
    return { ok: false, message: 'Set CHIEFOS_GMAIL_USER and CHIEFOS_GMAIL_APP_PASSWORD first.' };
  }
  try {
    await transporter().verify();
    return { ok: true, message: `Gmail accepted the credentials for ${USER}.` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
