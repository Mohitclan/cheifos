import 'server-only';
import { getInboxBlockers, getKpis, type UserRow } from '@/lib/db/queries';
import { getTodaysMeetings } from '@/lib/alerts';
import { getMissingToday, gapLabel } from '@/lib/reporting';
import { clock, day, todayIso } from '@/lib/format';
import type { Mail } from './types';

/**
 * The morning digest.
 *
 * Written to be read on a phone, half-awake, before anyone opens a laptop.
 * So: the thing that needs them first, then what is already arranged, then
 * what is quiet. Every number is a count of real records - this email makes
 * no claim the app would not make.
 *
 * Built with tables and inline styles on purpose. Email clients are a decade
 * behind browsers and will mangle flexbox, grid, and most external CSS.
 */

const BRAND = '#0F2238';
const ACCENT = '#0E7C86';
const MUTED = '#667085';
const LINE = '#DFE4EA';

export interface DigestContent {
  subject: string;
  greeting: string;
  needsYou: string[];
  meetings: string[];
  blocked: string[];
  quiet: string[];
  closing: string;
}

export function buildDigestContent(user: UserRow, appUrl: string): DigestContent {
  const kpis = getKpis();
  const meetings = getTodaysMeetings(user.id).filter((alert) => alert.urgency !== 'past');
  const inbox = getInboxBlockers().slice(0, 4);
  const missing = getMissingToday();

  const firstName = user.name.split(' ')[0];

  return {
    subject: `Your day, ${day(`${todayIso()}T09:00:00`)}${
      meetings.length ? ` - ${meetings.length} meeting${meetings.length === 1 ? '' : 's'}` : ''
    }`,
    greeting: `Good morning, ${firstName}. Here is where things stand.`,

    needsYou: inbox.length
      ? inbox.map((blocker) => `${blocker.title} - ${blocker.priority_reason}`)
      : [],

    meetings: meetings.map((alert) => {
      const who = alert.item.with_whom ? ` with ${alert.item.with_whom}` : '';
      const what = alert.item.topic ? ` about ${alert.item.topic}` : '';
      return `${clock(alert.item.start_at)}-${clock(alert.item.end_at)} ${alert.item.title}${who}${what}`;
    }),

    blocked:
      kpis.openBlockers > 0
        ? [`${kpis.openBlockers} open blocker${kpis.openBlockers === 1 ? '' : 's'}, ${kpis.highPriorityBlockers} high priority.`]
        : [],

    quiet: missing.map((person) => `${person.name} - ${gapLabel(person)}`),

    closing: `Nothing in ChiefOS sends or closes anything without you approving it. Open it at ${appUrl}`,
  };
}

function section(heading: string, lines: string[], tone = BRAND): string {
  if (lines.length === 0) return '';
  const items = lines
    .map(
      (line) =>
        `<tr><td style="padding:4px 0;font-size:14px;line-height:1.5;color:#2C333D;">${escapeHtml(line)}</td></tr>`,
    )
    .join('');

  return `
  <tr><td style="padding:18px 24px 0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding-bottom:6px;border-bottom:2px solid ${tone};">
        <span style="font-size:12px;font-weight:700;color:${tone};">${escapeHtml(heading)}</span>
      </td></tr>
      <tr><td style="padding-top:8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items}</table>
      </td></tr>
    </table>
  </td></tr>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderDigest(content: DigestContent, to: string, appUrl: string): Mail {
  const text = [
    content.greeting,
    '',
    ...(content.needsYou.length ? ['NEEDS YOU', ...content.needsYou.map((l) => `- ${l}`), ''] : []),
    ...(content.meetings.length ? ['MEETINGS TODAY', ...content.meetings.map((l) => `- ${l}`), ''] : []),
    ...(content.blocked.length ? ['BLOCKED WORK', ...content.blocked.map((l) => `- ${l}`), ''] : []),
    ...(content.quiet.length ? ['NOT REPORTED YET', ...content.quiet.map((l) => `- ${l}`), ''] : []),
    content.closing,
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#F2F5F8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F5F8;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="max-width:560px;background:#FFFFFF;border:1px solid ${LINE};border-radius:10px;font-family:-apple-system,'Segoe UI',Arial,sans-serif;">

    <tr><td style="padding:20px 24px;background:${BRAND};border-radius:10px 10px 0 0;">
      <span style="font-size:16px;font-weight:600;color:#FFFFFF;">ChiefOS</span>
      <span style="font-size:12px;color:#8FA6BC;"> &middot; AI Chief of Staff</span>
    </td></tr>

    <tr><td style="padding:20px 24px 0 24px;font-size:15px;line-height:1.5;color:#14181F;">
      ${escapeHtml(content.greeting)}
    </td></tr>

    ${section('Needs you', content.needsYou, '#B42318')}
    ${section('Meetings today', content.meetings, ACCENT)}
    ${section('Blocked work', content.blocked, '#B45309')}
    ${section('Not reported yet', content.quiet, MUTED)}

    <tr><td style="padding:22px 24px;">
      <a href="${escapeHtml(appUrl)}"
         style="display:inline-block;background:${ACCENT};color:#FFFFFF;text-decoration:none;
                font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;">Open ChiefOS</a>
    </td></tr>

    <tr><td style="padding:0 24px 22px 24px;font-size:11px;line-height:1.5;color:${MUTED};border-top:1px solid ${LINE};padding-top:14px;">
      Nothing in ChiefOS sends a message or closes a blocker without a human approving it.
      All people, projects and updates in this workspace are fictional demo data.
    </td></tr>

  </table>
</td></tr></table>
</body></html>`;

  return { to, subject: content.subject, text, html };
}

export function buildDigest(user: UserRow, to: string, appUrl: string): Mail {
  return renderDigest(buildDigestContent(user, appUrl), to, appUrl);
}
