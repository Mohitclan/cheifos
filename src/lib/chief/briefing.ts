import 'server-only';
import {
  getAuditTrail,
  getDueSoonTasks,
  getInboxBlockers,
  getKpis,
  getProjects,
  getRecentUpdates,
  getScheduleForDate,
  type UserRow,
} from '@/lib/db/queries';
import { getTodaysMeetings } from '@/lib/alerts';
import { clock, todayIso, tomorrowIso } from '@/lib/format';

/**
 * The spoken daily briefing.
 *
 * Composed entirely from rows. Every sentence below is assembled from a count
 * or a field that was read out of the database a moment earlier, which is the
 * only reason it is safe to let something speak with this much confidence:
 * it cannot say anything that is not true of an actual record.
 *
 * There is no model here and no generation. When there is nothing to report,
 * it says so rather than padding - "nothing is blocked" is a real answer.
 */

export interface BriefSegment {
  id: string;
  heading: string;
  /** What gets spoken aloud, and shown as the transcript line. */
  speech: string;
  /** Supporting lines rendered beside the transcript. Not spoken. */
  detail?: string[];
  tone: 'neutral' | 'blocked' | 'risk' | 'ok' | 'accent';
  href?: string;
}

export interface Briefing {
  greeting: string;
  segments: BriefSegment[];
  /** Questions the panel offers as buttons, so nobody has to guess. */
  suggestions: string[];
}

function partOfDay(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function buildBriefing(user: UserRow | undefined): Briefing {
  const now = new Date();
  const name = user?.name.split(' ')[0] ?? 'there';
  const kpis = getKpis();
  const inbox = getInboxBlockers();
  const projects = getProjects();
  const dueSoon = getDueSoonTasks(3);
  const segments: BriefSegment[] = [];

  // ---- What needs a decision -------------------------------------------
  if (inbox.length === 0) {
    segments.push({
      id: 'decisions',
      heading: 'Waiting on you',
      speech: 'Nothing is waiting on a decision from you right now.',
      tone: 'ok',
      href: '/decisions',
    });
  } else {
    const top = inbox[0];
    const rest = inbox.length - 1;
    segments.push({
      id: 'decisions',
      heading: 'Waiting on you',
      speech:
        `${plural(inbox.length, 'item needs', 'items need')} a decision from you. ` +
        `The first is ${top.title}, on ${top.project_name}, raised by ${top.raised_by_name ?? 'someone'}. ` +
        `${top.priority_reason} ` +
        (rest > 0 ? `There ${rest === 1 ? 'is' : 'are'} ${rest} more behind it.` : ''),
      detail: inbox.slice(0, 4).map(
        (blocker) =>
          `${blocker.priority.toUpperCase()} - ${blocker.title} (${blocker.project_name})`,
      ),
      tone: 'blocked',
      href: '/decisions',
    });
  }

  // ---- Projects --------------------------------------------------------
  const attention = projects.filter((p) => p.status === 'blocked' || p.status === 'at_risk');
  segments.push({
    id: 'projects',
    heading: 'Project health',
    speech:
      attention.length === 0
        ? `All ${kpis.activeProjects} active projects are on track.`
        : `${plural(attention.length, 'project needs', 'projects need')} attention out of ${kpis.activeProjects} active. ` +
          attention
            .slice(0, 3)
            .map(
              (project) =>
                `${project.name} is ${project.status === 'blocked' ? 'blocked' : 'at risk'} at ${project.progress} percent, owned by ${project.owner_name}`,
            )
            .join('. ') +
          '.',
    detail: attention.map(
      (project) => `${project.name} - ${project.status.replace('_', ' ')}, ${project.progress}%, ${project.owner_name}`,
    ),
    tone: attention.length ? 'risk' : 'ok',
    href: '/',
  });

  // ---- Deadlines -------------------------------------------------------
  if (dueSoon.length > 0) {
    segments.push({
      id: 'due',
      heading: 'Due within three days',
      speech:
        `${plural(dueSoon.length, 'task is', 'tasks are')} due within three days. ` +
        dueSoon
          .slice(0, 3)
          .map((task) => `${task.title}, owned by ${task.owner_name}`)
          .join('. ') +
        '.',
      detail: dueSoon.map((task) => `${task.title} - ${task.owner_name} (${task.status.replace('_', ' ')})`),
      tone: 'risk',
      href: '/',
    });
  }

  // ---- The day ---------------------------------------------------------
  const ownerId = user?.id ?? 0;
  const today = getScheduleForDate(ownerId, todayIso()).filter((item) => item.status === 'approved');
  const tomorrow = getScheduleForDate(ownerId, tomorrowIso());
  const upcoming = today.find((item) => new Date(item.end_at) > now);

  if (today.length === 0 && tomorrow.length === 0) {
    segments.push({
      id: 'schedule',
      heading: 'Your day',
      speech: 'You have no approved schedule for today or tomorrow. Tell me your priorities and I will propose one.',
      tone: 'neutral',
      href: '/schedule',
    });
  } else {
    const parts: string[] = [];
    if (today.length) {
      parts.push(`You have ${plural(today.length, 'block', 'blocks')} approved for today`);
      if (upcoming) {
        parts.push(`next up is ${upcoming.title} at ${clock(upcoming.start_at)}`);
      } else {
        parts.push('all of them are behind you');
      }
    }
    if (tomorrow.length) {
      const proposed = tomorrow.filter((item) => item.status === 'proposed').length;
      parts.push(
        proposed > 0
          ? `tomorrow has ${plural(proposed, 'block', 'blocks')} proposed and waiting on your approval`
          : `tomorrow is planned with ${plural(tomorrow.length, 'block', 'blocks')}`,
      );
    }
    segments.push({
      id: 'schedule',
      heading: 'Your day',
      speech: `${parts.join(', ')}.`,
      detail: today.map((item) => `${clock(item.start_at)}-${clock(item.end_at)} ${item.title}`),
      tone: 'accent',
      href: '/schedule',
    });
  }

  // ---- Meetings --------------------------------------------------------
  // Said separately from the day, and with who and what, because a meeting is
  // the one kind of block where somebody else is also waiting.
  const meetings = getTodaysMeetings(ownerId, now);
  if (meetings.length) {
    const ahead = meetings.filter((alert) => alert.urgency !== 'past');
    const next = ahead[0];

    segments.push({
      id: 'meetings',
      heading: meetings.length === 1 ? 'Your meeting today' : 'Your meetings today',
      speech: ahead.length
        ? `${plural(ahead.length, 'meeting', 'meetings')} still ahead of you today. ${next.headline}`
        : `All ${plural(meetings.length, 'meeting', 'meetings')} today are behind you.`,
      detail: meetings.map((alert) => {
        const who = alert.item.with_whom ? ` with ${alert.item.with_whom}` : '';
        const what = alert.item.topic ? ` about ${alert.item.topic}` : '';
        return `${clock(alert.item.start_at)}-${clock(alert.item.end_at)} ${alert.item.title}${who}${what}`;
      }),
      tone: ahead.length ? 'risk' : 'neutral',
      href: '/schedule',
    });
  }

  // ---- What changed ----------------------------------------------------
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recent = getAuditTrail(60).filter((entry) => new Date(entry.created_at) >= since);
  // Counted per category so the spoken summary accounts for everything the
  // detail lines below it show. A summary that skips a category reads as a
  // gap the moment somebody compares the two.
  const count = (action: string) => recent.filter((entry) => entry.action === action).length;
  const submitted = count('update.submitted');
  const raised = count('blocker.created');
  const sent = count('message.sent');
  const acknowledged = count('message.acknowledged');
  const scheduled = count('schedule.approved');
  const resolved = count('blocker.resolved');

  const changes: string[] = [];
  if (submitted) changes.push(`${plural(submitted, 'update was', 'updates were')} submitted`);
  if (raised) changes.push(`${plural(raised, 'blocker was', 'blockers were')} raised`);
  if (sent) changes.push(`${plural(sent, 'decision was', 'decisions were')} sent`);
  if (acknowledged) changes.push(`${plural(acknowledged, 'was', 'were')} acknowledged`);
  if (resolved) changes.push(`${plural(resolved, 'blocker was', 'blockers were')} resolved`);
  if (scheduled) changes.push(`${plural(scheduled, 'schedule block was', 'schedule blocks were')} approved`);

  segments.push({
    id: 'changes',
    heading: 'Last twenty-four hours',
    speech: changes.length
      ? `In the last twenty-four hours, ${changes.join(', ')}.`
      : 'Nothing has changed in the last twenty-four hours.',
    detail: recent.slice(0, 5).map((entry) => `${entry.actor_name ?? 'System'} - ${entry.summary}`),
    tone: 'neutral',
    href: '/activity',
  });

  // ---- The honest closing ---------------------------------------------
  segments.push({
    id: 'provenance',
    heading: 'Where this came from',
    speech:
      `Everything I just said is read from ${kpis.updatesThisWeek} updates and the records behind them. ` +
      'I do not generate any of it, and I cannot send or approve anything on your behalf.',
    tone: 'neutral',
  });

  const topProject = projects[0]?.name;

  return {
    greeting: `${partOfDay(now)}, ${name}. Here is where things stand.`,
    segments,
    suggestions: [
      'What needs me today?',
      'What is blocked?',
      'What is due soon?',
      topProject ? `How is ${topProject} doing?` : 'How are the projects doing?',
      'What happened since yesterday?',
      'What is on my schedule?',
    ],
  };
}

/** The most recent update text, used by the assistant for colour. */
export function latestUpdateLine(): string | null {
  const [latest] = getRecentUpdates(1);
  if (!latest) return null;
  return `${latest.employee_name} on ${latest.project_name}: "${latest.original_text}"`;
}
