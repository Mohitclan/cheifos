import * as chrono from 'chrono-node';
import { addMinutes, areIntervalsOverlapping, format } from 'date-fns';
import { DEFAULT_BLOCK_MINUTES, WORKDAY } from '@/lib/demo/constants';

/**
 * Schedule generation (section 9 of the product doc).
 *
 * Three responsibilities that never blur:
 *   - Text parsing PROPOSES candidate times and durations.
 *   - This module, deterministic application code, PLACES the blocks.
 *   - The CEO APPROVES. Nothing here writes to the database.
 *
 * Hard rules enforced below:
 *   - Nothing is silently dropped. A conflict is surfaced with both activities
 *     named and both blocks kept; the system does not choose for the user.
 *   - Every assumption is visible. An inferred duration or an inferred time is
 *     flagged on the block so the UI can mark it.
 *   - "Keep time for urgent issues" is an activity, not a special case. It
 *     becomes a real block like anything else.
 */

export interface ProposedBlock {
  /** Stable within one proposal; used as the form field key. */
  key: string;
  title: string;
  startAt: string;
  endAt: string;
  priority: 'high' | 'medium' | 'low';
  sourceText: string;
  isAssumedDuration: boolean;
  isAssumedTime: boolean;
}

export interface Conflict {
  /** Keys of the two overlapping blocks. */
  keys: [string, string];
  message: string;
}

export interface Proposal {
  planDate: string;
  blocks: ProposedBlock[];
  conflicts: Conflict[];
  /** Clauses that produced no block, surfaced rather than discarded. */
  unplaced: string[];
}

/** Time-of-day hints, mapped to a start hour. All of these are assumptions. */
const TIME_HINTS: Array<[RegExp, number]> = [
  [/\bfirst thing\b/, WORKDAY.startHour],
  [/\bearly\b/, WORKDAY.startHour],
  [/\bmorning\b/, 10],
  [/\bbefore lunch\b/, 11],
  [/\b(after lunch|afternoon)\b/, 14],
  [/\bmid-?day\b/, 12],
  [/\b(end of day|eod|last thing|evening)\b/, 16],
];

/** Digit durations ("45 minutes", "2 hrs") and written ones ("for an hour"). */
const DURATION_DIGITS = /\b(?:for\s+)?(\d{1,3})\s*(min|mins|minute|minutes|hr|hrs|hour|hours|h)\b/;
const DURATION_FRACTION = /\b(half|quarter)\s+(?:an\s+)?hour\b/;
const DURATION_WORDS = /\b(?:for\s+)?(a|an|one|two|three)\s+hours?\b/;

const WORD_HOURS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };

/** Everything that reads as a duration, for stripping before time parsing. */
const DURATION_ANYWHERE =
  /\b(?:for\s+)?(?:\d{1,3}\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours|h)|(?:a|an|one|two|three|half|quarter)\s+(?:an\s+)?hours?)\b/gi;

const PRIORITY_HINTS: Array<[RegExp, 'high' | 'low']> = [
  [/\b(urgent|critical|must|important|priority|first|asap|blocker)\b/, 'high'],
  [/\b(if there is time|optional|nice to have|maybe)\b/, 'low'],
];

/** Fillers that are not activities on their own. */
const CLAUSE_NOISE = /^(?:and|then|also|after that|next|plus|finally|so)\b/i;

function splitClauses(input: string): string[] {
  return input
    .split(/[\n;,]|\bthen\b|\band then\b|\bafter that\b/i)
    .map((part) => part.trim().replace(CLAUSE_NOISE, '').trim())
    .map((part) => part.replace(/^\s*[-*•]\s*/, '').trim())
    .filter((part) => part.length >= 3);
}

function parseDuration(clause: string): { minutes: number; assumed: boolean } {
  const fraction = clause.match(DURATION_FRACTION);
  if (fraction) {
    return { minutes: fraction[1].toLowerCase() === 'half' ? 30 : 15, assumed: false };
  }

  const digits = clause.match(DURATION_DIGITS);
  if (digits) {
    const value = Number(digits[1]);
    const unit = digits[2].toLowerCase();
    const minutes = unit.startsWith('h') ? value * 60 : value;
    if (minutes > 0 && minutes <= 480) return { minutes, assumed: false };
  }

  const words = clause.match(DURATION_WORDS);
  if (words) {
    const hours = WORD_HOURS[words[1].toLowerCase()] ?? 1;
    return { minutes: hours * 60, assumed: false };
  }

  // No duration stated. The default is an assumption and is marked as one.
  return { minutes: DEFAULT_BLOCK_MINUTES, assumed: true };
}

function parsePriority(clause: string): 'high' | 'medium' | 'low' {
  for (const [pattern, priority] of PRIORITY_HINTS) {
    if (pattern.test(clause)) return priority;
  }
  return 'medium';
}

/**
 * Candidate start hour for a clause.
 *
 * `explicit` means the text named a time ("at 2pm", "11:30"). Everything else
 * is a time-of-day hint or nothing at all, and both are assumptions.
 */
function parseStart(
  clause: string,
  planDate: Date,
): { hour: number; minute: number; explicit: boolean } | null {
  // chrono proposes; it never commits. A reference pinned to the plan day
  // keeps "2pm" on the right date.
  const reference = new Date(planDate);
  reference.setHours(WORKDAY.startHour, 0, 0, 0);

  // A duration must not be read as a clock time: without this strip,
  // "interview for 45 minutes" parses as 00:45 and lands at 09:45.
  const withoutDurations = clause.replace(DURATION_ANYWHERE, ' ');

  for (const result of chrono.parse(withoutDurations, reference, { forwardDate: true })) {
    // isCertain means the text stated the hour rather than chrono defaulting
    // it. Combined with the clock-shape check, that is what "explicit" means.
    const looksLikeClock = /\d|noon|midday|midnight/i.test(result.text);
    if (result.start.isCertain('hour') && looksLikeClock) {
      return {
        hour: result.start.get('hour') ?? WORKDAY.startHour,
        minute: result.start.get('minute') ?? 0,
        explicit: true,
      };
    }
  }

  for (const [pattern, hour] of TIME_HINTS) {
    if (pattern.test(clause)) return { hour, minute: 0, explicit: false };
  }
  return null;
}

/** Strips scheduling scaffolding so the title reads like an activity. */
function cleanTitle(clause: string): string {
  let title = clause
    .replace(/^(?:and|then|also|plus|next|finally|so)\s+/i, '')
    .replace(/^(?:i\s+)?(?:need to|want to|have to|should|must|let us|lets|let's)\s+/i, '')
    .replace(/^(?:please\s+)/i, '')
    .replace(/\b(?:at|by|around|from)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, '')
    .replace(DURATION_ANYWHERE, '')
    .replace(/\b(first thing|in the morning|morning|after lunch|afternoon|end of day|eod|last thing)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .trim();

  if (!title) title = clause.trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return title.length > 80 ? `${title.slice(0, 77)}...` : title;
}

function clampToWorkday(date: Date, minutes: number, planDate: Date): Date {
  const dayStart = new Date(planDate);
  dayStart.setHours(WORKDAY.startHour, 0, 0, 0);
  const lastStart = new Date(planDate);
  lastStart.setHours(WORKDAY.endHour, 0, 0, 0);
  lastStart.setMinutes(lastStart.getMinutes() - minutes);

  if (date < dayStart) return dayStart;
  if (date > lastStart) return lastStart < dayStart ? dayStart : lastStart;
  return date;
}

/**
 * Builds a proposal. Pure: same input, same output, no database, and no clock
 * beyond the plan date it is handed.
 */
export function planDay(input: string, planDate: string): Proposal {
  const base = new Date(`${planDate}T00:00:00`);
  const clauses = splitClauses(input);
  const unplaced: string[] = [];

  interface Draft {
    key: string;
    title: string;
    sourceText: string;
    minutes: number;
    assumedDuration: boolean;
    priority: 'high' | 'medium' | 'low';
    start: { hour: number; minute: number; explicit: boolean } | null;
    order: number;
  }

  const drafts: Draft[] = [];
  clauses.forEach((clause, index) => {
    const title = cleanTitle(clause);
    if (!title || title.length < 3) {
      unplaced.push(clause);
      return;
    }
    const duration = parseDuration(clause);
    drafts.push({
      key: `b${index}`,
      title,
      sourceText: clause,
      minutes: duration.minutes,
      assumedDuration: duration.assumed,
      priority: parsePriority(clause),
      start: parseStart(clause, base),
      order: index,
    });
  });

  // Placement order: explicit times first so they keep the slot they named,
  // then time-of-day hints earliest first, then declaration order.
  const explicit = drafts.filter((d) => d.start?.explicit);
  const hinted = drafts
    .filter((d) => d.start && !d.start.explicit)
    .sort((a, b) => a.start!.hour - b.start!.hour || a.order - b.order);
  const unanchored = drafts.filter((d) => !d.start);

  const placed: ProposedBlock[] = [];

  const place = (draft: Draft, startAt: Date, assumedTime: boolean): void => {
    const start = clampToWorkday(startAt, draft.minutes, base);
    placed.push({
      key: draft.key,
      title: draft.title,
      startAt: start.toISOString(),
      endAt: addMinutes(start, draft.minutes).toISOString(),
      priority: draft.priority,
      sourceText: draft.sourceText,
      isAssumedDuration: draft.assumedDuration,
      isAssumedTime: assumedTime,
    });
  };

  for (const draft of explicit) {
    const at = new Date(base);
    at.setHours(draft.start!.hour, draft.start!.minute, 0, 0);
    place(draft, at, false);
  }

  for (const draft of hinted) {
    const at = new Date(base);
    at.setHours(draft.start!.hour, draft.start!.minute, 0, 0);
    place(draft, nextFreeFrom(at, draft.minutes, placed, base), true);
  }

  for (const draft of unanchored) {
    const dayStart = new Date(base);
    dayStart.setHours(WORKDAY.startHour, 0, 0, 0);
    place(draft, nextFreeFrom(dayStart, draft.minutes, placed, base), true);
  }

  placed.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.key.localeCompare(b.key));

  return {
    planDate,
    blocks: placed,
    conflicts: findConflicts(placed),
    unplaced,
  };
}

/**
 * First slot at or after `from` that does not overlap an already placed block.
 * Used only for blocks whose time was inferred - a block whose time the user
 * stated explicitly keeps that time even if it collides, because moving it
 * quietly is exactly the behaviour section 9 forbids.
 */
function nextFreeFrom(from: Date, minutes: number, placed: ProposedBlock[], planDate: Date): Date {
  const dayEnd = new Date(planDate);
  dayEnd.setHours(WORKDAY.endHour, 0, 0, 0);

  let candidate = new Date(from);
  for (let guard = 0; guard < 40; guard++) {
    const end = addMinutes(candidate, minutes);
    if (end > dayEnd) return candidate;

    const clash = placed.find((block) =>
      areIntervalsOverlapping(
        { start: candidate, end },
        { start: new Date(block.startAt), end: new Date(block.endAt) },
      ),
    );
    if (!clash) return candidate;
    candidate = new Date(clash.endAt);
  }
  return candidate;
}

/** Overlap detection over the final placement. Reported, never resolved. */
export function findConflicts(blocks: ProposedBlock[]): Conflict[] {
  const conflicts: Conflict[] = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      const overlapping = areIntervalsOverlapping(
        { start: new Date(a.startAt), end: new Date(a.endAt) },
        { start: new Date(b.startAt), end: new Date(b.endAt) },
      );
      if (!overlapping) continue;
      conflicts.push({
        keys: [a.key, b.key],
        message:
          `"${a.title}" (${formatRange(a)}) overlaps "${b.title}" (${formatRange(b)}). ` +
          'Both have been kept - adjust one and approve again.',
      });
    }
  }
  return conflicts;
}

export function formatRange(block: { startAt: string; endAt: string }): string {
  return `${format(new Date(block.startAt), 'HH:mm')}-${format(new Date(block.endAt), 'HH:mm')}`;
}

/** Overlap check over rows already in the database, for the saved view. */
export function findRowConflicts(
  rows: Array<{ id: number; title: string; start_at: string; end_at: string }>,
): Array<{ ids: [number, number]; message: string }> {
  const out: Array<{ ids: [number, number]; message: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (
        areIntervalsOverlapping(
          { start: new Date(a.start_at), end: new Date(a.end_at) },
          { start: new Date(b.start_at), end: new Date(b.end_at) },
        )
      ) {
        out.push({
          ids: [a.id, b.id],
          message:
            `"${a.title}" (${format(new Date(a.start_at), 'HH:mm')}-${format(new Date(a.end_at), 'HH:mm')}) ` +
            `overlaps "${b.title}" (${format(new Date(b.start_at), 'HH:mm')}-${format(new Date(b.end_at), 'HH:mm')}).`,
        });
      }
    }
  }
  return out;
}
