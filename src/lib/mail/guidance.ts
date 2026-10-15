import { clock } from '@/lib/format';
import { appUrl, getMailProvider } from './provider';
import type { Mail, MailResult } from './types';

/**
 * Delivering an approved decision to the person who raised the blocker.
 *
 * ChiefOS no longer has an employee surface - nobody logs in here but the
 * CEO - so an approved decision has no inbox to land in. Email is the whole
 * delivery mechanism.
 *
 * Two rules this file exists to hold:
 *
 * Delivery is separate from the decision. The decision is recorded whether or
 * not the email leaves. A failed send must never roll back the fact that the
 * CEO decided, and a recorded decision must never imply it arrived - the
 * audit trail says which happened.
 *
 * The CEO's words go out unchanged. This wraps them in a header and a link
 * and adds nothing of its own, because the employee is reading what their
 * CEO wrote, not what a system generated.
 */

export interface GuidanceEmail {
  to: string;
  recipientName: string;
  senderName: string;
  blockerTitle: string;
  projectName: string;
  body: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderGuidance(input: GuidanceEmail): Mail {
  const text = [
    `${input.recipientName},`,
    '',
    input.body,
    '',
    `- ${input.senderName}`,
    '',
    `In reply to: ${input.blockerTitle} (${input.projectName})`,
    '',
    'This was written and approved by a person. Reply to this email to respond.',
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;background:#F2F5F8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="max-width:540px;background:#FFFFFF;border:1px solid #DFE4EA;border-radius:10px;
           font-family:-apple-system,'Segoe UI',Arial,sans-serif;">

    <tr><td style="padding:16px 22px;background:#0F2238;border-radius:10px 10px 0 0;color:#8FA6BC;font-size:12px;">
      A decision from ${escapeHtml(input.senderName)}
    </td></tr>

    <tr><td style="padding:20px 22px 4px 22px;font-size:12px;color:#667085;">
      On: <strong style="color:#14181F;">${escapeHtml(input.blockerTitle)}</strong>
      &middot; ${escapeHtml(input.projectName)}
    </td></tr>

    <tr><td style="padding:12px 22px;">
      <div style="border-left:3px solid #0E7C86;padding-left:14px;font-size:15px;
                  line-height:1.6;color:#14181F;white-space:pre-wrap;">${escapeHtml(input.body)}</div>
    </td></tr>

    <tr><td style="padding:8px 22px 20px 22px;font-size:13px;color:#2C333D;">
      &mdash; ${escapeHtml(input.senderName)}
    </td></tr>

    <tr><td style="padding:0 22px 20px 22px;font-size:11px;line-height:1.5;color:#667085;
                   border-top:1px solid #DFE4EA;padding-top:14px;">
      This was written and approved by a person, not generated. Reply to this email to respond.
      The blocker stays open until someone resolves it.
    </td></tr>

  </table>
</td></tr></table></body></html>`;

  return {
    to: input.to,
    subject: `Re: ${input.blockerTitle}`,
    text,
    html,
  };
}

/**
 * Sends it. Returns the result rather than throwing: the caller has already
 * recorded the decision, and a delivery failure is reported, not reversed.
 */
export async function sendGuidance(input: GuidanceEmail): Promise<MailResult> {
  const provider = getMailProvider();

  if (!provider.configured) {
    return {
      ok: false,
      message: 'Decision recorded. No mail provider configured, so nothing was emailed.',
    };
  }
  if (!input.to) {
    return {
      ok: false,
      message: `Decision recorded. ${input.recipientName} has no email address on file, so nothing was sent.`,
    };
  }

  const result = await provider.send(renderGuidance(input));
  return result.ok
    ? { ...result, message: `Approved and emailed to ${input.to}.` }
    : { ...result, message: `Decision recorded, but the email failed: ${result.message}` };
}

export { clock, appUrl };
