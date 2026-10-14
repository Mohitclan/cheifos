/**
 * Sending the daily digest by email.
 *
 * Same seam as the AI provider and the update source: one interface, a default
 * that does nothing, and a real implementation behind an env var. Composing
 * the digest and delivering it are deliberately separate - the content is
 * worth having and testing long before there is anywhere to send it from.
 */

export interface Mail {
  to: string;
  subject: string;
  /** Plain text. Always sent, because some clients and most watches show it. */
  text: string;
  /** HTML. Built with tables and inline styles; email clients are not browsers. */
  html: string;
}

export interface MailResult {
  ok: boolean;
  message: string;
  /** The provider's id for the message, when it gives one. */
  id?: string;
}

export interface MailProvider {
  readonly id: string;
  readonly label: string;
  /** True once credentials are present. False means "composed but not sent". */
  readonly configured: boolean;
  send(mail: Mail): Promise<MailResult>;
}
