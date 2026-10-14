/**
 * Rewrites spoken clock times into digits before the schedule parser sees them.
 *
 * Speech-to-text writes numbers as words - "meet Finance at four" - and the
 * parser needs a digit to trust an hour. Without this the dictated time is
 * silently dropped and the block lands at the start of the working day, which
 * is worse than refusing it: the schedule looks right and is not.
 *
 * Patterns use the /regex/ literal form rather than template strings on
 * purpose. In a template literal a single \b is the backspace character, not a
 * word boundary, and the pattern then quietly never matches.
 */

const HOURS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const MINUTES: Record<string, number> = {
  'oh five': 5, 'zero five': 5, five: 5, ten: 10, fifteen: 15, twenty: 20,
  'twenty five': 25, thirty: 30, 'thirty five': 35, forty: 40,
  'forty five': 45, fifty: 50, 'fifty five': 55,
};

const HOUR_WORDS = Object.keys(HOURS).join('|');
// Longest first, so "twenty five" wins over "five".
const MINUTE_WORDS = Object.keys(MINUTES)
  .sort((a, b) => b.length - a.length)
  .join('|');

const HALF_PAST = new RegExp(`\\b(half|quarter)\\s+past\\s+(${HOUR_WORDS}|\\d{1,2})\\b`, 'gi');
const QUARTER_TO = new RegExp(`\\bquarter\\s+to\\s+(${HOUR_WORDS}|\\d{1,2})\\b`, 'gi');
const HOUR_MINUTE = new RegExp(`\\b(${HOUR_WORDS})\\s+(${MINUTE_WORDS})\\b`, 'gi');
const HOUR_BEFORE_MERIDIEM = new RegExp(
  `\\b(${HOUR_WORDS})\\b(?=\\s*(?:am|pm|a\\.m\\.?|p\\.m\\.?|o'?clock|in the (?:morning|afternoon|evening)))`,
  'gi',
);
const BARE_HOUR_AFTER_AT = new RegExp(`\\bat\\s+(${HOUR_WORDS})\\b`, 'gi');

export function normaliseSpokenTime(input: string): string {
  let text = input;

  // "half past three" -> "3:30", "quarter past three" -> "3:15"
  text = text.replace(HALF_PAST, (_m, frac: string, hour: string) => {
    const h = HOURS[hour.toLowerCase()] ?? Number(hour);
    return `${h}:${frac.toLowerCase() === 'half' ? '30' : '15'}`;
  });

  // "quarter to four" -> "3:45"
  text = text.replace(QUARTER_TO, (_m, hour: string) => {
    const h = HOURS[hour.toLowerCase()] ?? Number(hour);
    return `${h === 1 ? 12 : h - 1}:45`;
  });

  // "nine thirty" -> "9:30"
  text = text.replace(HOUR_MINUTE, (whole: string, hour: string, minute: string) => {
    const m = MINUTES[minute.toLowerCase()];
    if (m === undefined) return whole;
    return `${HOURS[hour.toLowerCase()]}:${String(m).padStart(2, '0')}`;
  });

  // "four pm", "four o'clock", "ten in the morning" -> digits
  text = text.replace(HOUR_BEFORE_MERIDIEM, (_m, hour: string) => String(HOURS[hour.toLowerCase()]));

  // A bare hour after "at": "meet them at four"
  text = text.replace(BARE_HOUR_AFTER_AT, (_m, hour: string) => `at ${HOURS[hour.toLowerCase()]}`);

  // chrono handles "4 pm" but trips on a trailing "o'clock".
  return text
    .replace(/\s*\bo'?clock\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
