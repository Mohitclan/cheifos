import 'server-only';
import { all, audit, nowIso, run, tx } from '@/lib/db';
import { getUser } from '@/lib/db/queries';
import { clock } from '@/lib/format';
import { appUrl, getMailProvider } from './provider';
import type { Mail } from './types';

/**
 * Lead-time reminders: "your 4pm meeting is in two hours".
 *
 * Two rules make this safe to run on a timer.
 *
 * First, a block is only ever alerted once - alert_sent_at is written in the
 * same transaction as the send, so a job running every ten minutes cannot
 * send the same reminder six times.
 *
 * Second, a block whose lead time has already passed is marked as alerted
 * without sending. If the machine was asleep over the window, the right
 * behaviour is silence, not a reminder for a meeting that starts in four
 * minutes dressed up as two hours' notice.
 */

const LEAD_MINUTES = Number(process.env.CHIEFOS_ALERT_LEAD_MINUTES ?? 120);

interface DueRow {
  id: number;
  owner_id: number;
  title: string;
  start_at: string;
  end_at: string;
  kind: 'meeting' | 'focus';
  with_whom: string | null;
  topic: string | null;
  source_text: string | null;
}

/**
 * Approved blocks whose lead window has opened and that have not been alerted.
 * Only meetings: an hour you set aside for yourself does not need two hours'
 * warning, and alerting on everything is how people learn to ignore alerts.
 */
export function getDueReminders(now: Date = new Date()): DueRow[] {
  const windowEnd = new Date(now.getTime() + LEAD_MINUTES * 60_000).toISOString();

  return all<DueRow>(
    `SELECT id, owner_id, title, start_at, end_at, kind, with_whom, topic, source_text
       FROM schedule_items
      WHERE status = 'approved'
        AND kind = 'meeting'
        AND alert_sent_at IS NULL
        AND start_at > ?
        AND start_at <= ?
      ORDER BY start_at`,
    [now.toISOString(), windowEnd],
  );
}

function buildReminder(row: DueRow, to: string, minutesAway: number): Mail {
  const who = row.with_whom ? ` with ${row.with_whom}` : '';
  const what = row.topic ? ` about ${row.topic}` : '';
  const hours = Math.round((minutesAway / 60) * 10) / 10;
  const away = minutesAway >= 90 ? `${hours} hours` : `${minutesAway} minutes`;

  const subject = `In ${away}: ${row.title}${who}`;
  const lines = [
    `${row.title}${who}${what}`,
    `${clock(row.start_at)} to ${clock(row.end_at)} - that is ${away} from now.`,
    row.source_text ? `You asked for: "${row.source_text}"` : '',
    '',
    `Open ChiefOS: ${appUrl()}`,
  ].filter(Boolean);

  return {
    to,
    subject,
    text: lines.join('\n'),
    html: `<!doctype html><html><body style="margin:0;background:#F2F5F8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="max-width:520px;background:#FFFFFF;border:1px solid #DFE4EA;border-radius:10px;
           font-family:-apple-system,'Segoe UI',Arial,sans-serif;">
    <tr><td style="padding:18px 22px;background:#0F2238;border-radius:10px 10px 0 0;color:#FFFFFF;font-size:13px;">
      ChiefOS &middot; coming up
    </td></tr>
    <tr><td style="padding:20px 22px 6px 22px;font-size:18px;font-weight:600;color:#14181F;">
      ${escapeHtml(row.title)}${escapeHtml(who)}
    </td></tr>
    ${row.topic ? `<tr><td style="padding:0 22px 6px 22px;font-size:14px;color:#2C333D;">About ${escapeHtml(row.topic)}</td></tr>` : ''}
    <tr><td style="padding:0 22px 4px 22px;font-size:14px;color:#2C333D;">
      ${clock(row.start_at)} to ${clock(row.end_at)} &middot; in ${escapeHtml(away)}
    </td></tr>
    ${row.source_text ? `<tr><td style="padding:8px 22px 0 22px;font-size:12px;color:#667085;">You asked for: &ldquo;${escapeHtml(row.source_text)}&rdquo;</td></tr>` : ''}
    <tr><td style="padding:18px 22px 22px 22px;">
      <a href="${escapeHtml(appUrl())}" style="display:inline-block;background:#0E7C86;color:#FFFFFF;
         text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px;">Open ChiefOS</a>
    </td></tr>
  </table>
</td></tr></table></body></html>`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface ReminderRunResult {
  checked: number;
  sent: number;
  skipped: number;
  errors: string[];
}

/**
 * One pass. Safe to call as often as you like - idempotent per block.
 * `to` resolves per owner; without an address the block is left alone so it
 * can be sent once an address exists rather than silently marked as done.
 */
export async function runReminders(
  resolveAddress: (ownerId: number) => string | null,
  now: Date = new Date(),
): Promise<ReminderRunResult> {
  const due = getDueReminders(now);
  const provider = getMailProvider();
  const result: ReminderRunResult = { checked: due.length, sent: 0, skipped: 0, errors: [] };

  if (!provider.configured) {
    result.errors.push('No mail provider configured; nothing was sent.');
    return result;
  }

  for (const row of due) {
    const to = resolveAddress(row.owner_id);
    if (!to) {
      result.skipped += 1;
      continue;
    }

    const minutesAway = Math.round((new Date(row.start_at).getTime() - now.getTime()) / 60_000);
    const mail = buildReminder(row, to, minutesAway);
    const sendResult = await provider.send(mail);

    if (!sendResult.ok) {
      result.errors.push(`${row.title}: ${sendResult.message}`);
      continue;
    }

    tx(() => {
      run('UPDATE schedule_items SET alert_sent_at = ? WHERE id = ?', [nowIso(), row.id]);
      audit({
        actorId: row.owner_id,
        action: 'reminder.sent',
        entityType: 'schedule_item',
        entityId: row.id,
        summary: `Reminder emailed to ${to}: ${row.title} starts in ${minutesAway} minutes.`,
        metadata: { to, provider: provider.id, minutesAway },
      });
    });
    result.sent += 1;
  }

  return result;
}

/**
 * Marks blocks whose lead window closed while nothing was running, so they do
 * not fire late. Silence beats a reminder that misrepresents how much notice
 * it is giving.
 */
export function expireMissedReminders(now: Date = new Date()): number {
  const rows = all<{ id: number }>(
    `SELECT id FROM schedule_items
      WHERE status = 'approved' AND kind = 'meeting'
        AND alert_sent_at IS NULL AND start_at <= ?`,
    [now.toISOString()],
  );

  for (const row of rows) {
    run('UPDATE schedule_items SET alert_sent_at = ? WHERE id = ?', [nowIso(), row.id]);
  }
  return rows.length;
}

export function ownerAddress(ownerId: number): string | null {
  // No address column yet: one recipient, from the environment. When this
  // becomes multi-user it moves to a column on users.
  const configured = process.env.CHIEFOS_ALERT_TO ?? '';
  return getUser(ownerId) && configured ? configured : null;
}

export { LEAD_MINUTES };
