import { getScheduleForDate, type ScheduleRow } from '@/lib/db/queries';
import { clock, todayIso, tomorrowIso } from '@/lib/format';

/**
 * What the CEO needs to be told about their day, right now.
 *
 * Deliberately not a browser notification. Those only fire while the app is
 * open, arrive late when the machine sleeps, and fail silently - so a CEO
 * would learn, correctly, not to rely on them. An always-visible strip that
 * is recomputed on every render is less impressive and always right, which is
 * the better trade for something whose whole job is to be trusted.
 *
 * Only meetings raise an alert. An hour you set aside for yourself can move;
 * a meeting is someone else's time as well as yours.
 */

export type AlertUrgency = 'now' | 'soon' | 'later' | 'past';

export interface ScheduleAlert {
  item: ScheduleRow;
  urgency: AlertUrgency;
  minutesAway: number;
  /** One line, written to be read aloud as well as shown. */
  headline: string;
  /** Who and what, when the request said. Empty when it did not. */
  context: string[];
}

function minutesUntil(iso: string, now: Date): number {
  return Math.round((new Date(iso).getTime() - now.getTime()) / 60000);
}

function urgencyFor(startsIn: number, endsIn: number): AlertUrgency {
  if (endsIn <= 0) return 'past';
  if (startsIn <= 0) return 'now';
  if (startsIn <= 30) return 'soon';
  return 'later';
}

function headlineFor(item: ScheduleRow, urgency: AlertUrgency, startsIn: number): string {
  const who = item.with_whom ? ` with ${item.with_whom}` : '';
  const what = item.topic ? ` about ${item.topic}` : '';
  const subject = item.kind === 'meeting' ? `${item.title}${who}${what}` : item.title;

  switch (urgency) {
    case 'now':
      return `Happening now: ${subject}, until ${clock(item.end_at)}.`;
    case 'soon':
      return `In ${startsIn} ${startsIn === 1 ? 'minute' : 'minutes'}: ${subject}, at ${clock(item.start_at)}.`;
    case 'later':
      return `At ${clock(item.start_at)}: ${subject}.`;
    default:
      return `${clock(item.start_at)} ${subject} has finished.`;
  }
}

function contextFor(item: ScheduleRow): string[] {
  const lines: string[] = [];
  if (item.with_whom) lines.push(`With ${item.with_whom}`);
  if (item.topic) lines.push(`Topic: ${item.topic}`);
  lines.push(`${clock(item.start_at)} to ${clock(item.end_at)}`);
  // The original wording is kept so the CEO can see what they actually asked
  // for, rather than only the system's reading of it.
  if (item.source_text) lines.push(`You asked for: "${item.source_text}"`);
  if (item.status === 'proposed') lines.push('Not approved yet - this is still a proposal.');
  return lines;
}

/** Everything on today's plan, newest-relevant first. */
export function getDayAlerts(ownerId: number, now: Date = new Date()): ScheduleAlert[] {
  const items = getScheduleForDate(ownerId, todayIso());

  return items
    .map((item) => {
      const startsIn = minutesUntil(item.start_at, now);
      const endsIn = minutesUntil(item.end_at, now);
      const urgency = urgencyFor(startsIn, endsIn);
      return {
        item,
        urgency,
        minutesAway: startsIn,
        headline: headlineFor(item, urgency, startsIn),
        context: contextFor(item),
      };
    })
    .sort((a, b) => a.item.start_at.localeCompare(b.item.start_at));
}

/**
 * The single thing to put in front of the CEO. A meeting in progress or
 * imminent outranks everything; otherwise the next thing still ahead.
 */
export function getNextAlert(ownerId: number, now: Date = new Date()): ScheduleAlert | null {
  const alerts = getDayAlerts(ownerId, now);

  const live = alerts.find((alert) => alert.urgency === 'now' && alert.item.kind === 'meeting');
  if (live) return live;

  const soonMeeting = alerts.find((alert) => alert.urgency === 'soon' && alert.item.kind === 'meeting');
  if (soonMeeting) return soonMeeting;

  const anyLive = alerts.find((alert) => alert.urgency === 'now');
  if (anyLive) return anyLive;

  const aheadToday = alerts.find((alert) => alert.urgency === 'soon' || alert.urgency === 'later');
  if (aheadToday) return aheadToday;

  // Nothing left today. Looking at tomorrow matters because the useful moment
  // for "you have a client call first thing" is the evening before, not the
  // morning of.
  const tomorrow = getScheduleForDate(ownerId, tomorrowIso());
  const first = tomorrow[0];
  if (!first) return null;

  const who = first.with_whom ? ` with ${first.with_whom}` : '';
  const what = first.topic ? ` about ${first.topic}` : '';

  return {
    item: first,
    urgency: 'later',
    minutesAway: minutesUntil(first.start_at, now),
    headline: `Tomorrow starts at ${clock(first.start_at)}: ${first.title}${who}${what}.`,
    context: [
      ...contextFor(first),
      `${tomorrow.length} ${tomorrow.length === 1 ? 'block' : 'blocks'} planned for tomorrow.`,
    ],
  };
}

/** Today's meetings only, for the briefing and the assistant. */
export function getTodaysMeetings(ownerId: number, now: Date = new Date()): ScheduleAlert[] {
  return getDayAlerts(ownerId, now).filter((alert) => alert.item.kind === 'meeting');
}
