import type { AiProvider, Extraction, ExtractionContext } from './types';
import { emptyExtraction } from './types';

/**
 * Deterministic update extraction. No model, no network, no RAM cost.
 *
 * Design principle, and the reason this is worth more than a better parser:
 * when a field cannot be read, this returns null and raises a clarification
 * question. It never guesses. A wrong confident answer costs more credibility
 * than an honest question, especially in front of people who have been burned
 * by AI tools that invent things.
 */

const WORD_NUMBERS: Record<string, number> = {
  ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** Lexical progress anchors. Everything here is flagged as inferred. */
const PROGRESS_ANCHORS: Array<[RegExp, number]> = [
  [/\b(just|only)\s+(started|began|kicked off)\b/, 10],
  [/\bbarely\s+started\b/, 5],
  [/\b(half\s*way|halfway|half\s+done|about\s+half)\b/, 50],
  [/\b(almost|nearly)\s+(done|finished|complete|ready|there)\b/, 90],
  [/\b(basically|pretty much)\s+(done|finished|complete|ready)\b/, 90],
  [/\bwrapping\s+up\b/, 85],
  [/\bwell\s+under\s*way\b/, 60],
  [/\bgetting\s+started\b/, 10],
];

const STATUS_PATTERNS: Array<[RegExp, Extraction['status']]> = [
  // Completion first - "shipped, no issues" must not be read as at risk.
  [/\b(shipped|merged|deployed|completed|finished|done and|all done|wrapped up|signed off)\b/, 'done'],
  [/\b(blocked|stuck|waiting on|waiting for|held up|hung up|can'?t proceed|cannot proceed|can'?t move|pending on|dependent on|depends on)\b/, 'blocked'],
  [/\b(at risk|slipping|(might|may|could)\s+(slip|miss|be late|push)|going to miss|behind schedule|behind on|running late|worried|concerned|tight on time)\b/, 'at_risk'],
  [/\b(on track|going well|no issues|no blockers|all good|smooth|as planned)\b/, 'on_track'],
];

const BLOCKER_MARKERS = [
  'blocked because', 'blocked on', 'blocked by', 'blocker is',
  'stuck on', 'stuck because', 'stuck with',
  'waiting on', 'waiting for', 'held up by', 'held up on',
  'pending', 'depends on', 'dependent on',
  "can't proceed until", 'cannot proceed until', "can't finish until",
];

const HELP_MARKERS = [
  'i need', 'we need', 'need someone to', 'need a', 'need the', 'need to get',
  'can someone', 'could someone', 'would help if', 'requires', 'require',
  'asking for', 'looking for', 'would like',
];

const RISK_MARKERS = [
  'risk is', 'risk that', 'the risk', 'may be delayed', 'might be delayed',
  'could slip', 'might slip', 'may slip', 'worried that', 'concern is',
  'could delay', 'may delay', 'might push',
];

const DEADLINE_PATTERNS = [
  /\b(today|tomorrow|tonight|this morning|this afternoon|this evening)\b/,
  /\bby\s+(end of day|eod|eow|end of week|close of business|cob)\b/,
  /\b(end of day|eod|eow|end of week)\b/,
  /\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  /\b(this|next)\s+(week|month|monday|tuesday|wednesday|thursday|friday|sprint)\b/,
  /\bby\s+the\s+\d{1,2}(st|nd|rd|th)?\b/,
  /\bby\s+\d{1,2}\s*(am|pm)\b/,
  /\bin\s+(a|two|three|a few)\s+(day|days|weeks?)\b/,
];

/** Common informal names for departments, mapped to canonical seeded names. */
const DEPARTMENT_ALIASES: Record<string, string[]> = {
  Finance: ['finance', 'fin', 'accounts', 'accounting', 'billing team'],
  Legal: ['legal', 'legal team', 'compliance', 'counsel'],
  Design: ['design', 'ux', 'ui team', 'product design'],
  Data: ['data', 'data team', 'analytics', 'bi', 'data eng'],
  'Product Engineering': ['product engineering', 'product eng', 'engineering', 'eng', 'platform'],
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Cuts a captured clause at the first sentence or conjunction boundary. */
function trimClause(raw: string): string | null {
  let clause = raw
    .replace(/^[\s,:-]+/, '')
    .split(/[.!?;]/)[0]
    .split(/\b(?:but|and then|so that|however|although|also)\b/)[0]
    .trim()
    .replace(/[\s,]+$/, '');

  // Strip a trailing "to finish the integration" style tail only when it would
  // otherwise swallow the next clause entirely.
  if (clause.length > 160) clause = clause.slice(0, 160).trim() + '...';
  return clause.length >= 3 ? clause : null;
}

function captureAfter(text: string, markers: string[]): string | null {
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    if (idx === -1) continue;
    const clause = trimClause(text.slice(idx + marker.length));
    if (clause) return clause;
  }
  return null;
}

function extractProgress(text: string, inferred: string[]): number | null {
  // No trailing \b: "%" is a non-word character, so \b would never match in
  // "70% done" - the space after % gives no word boundary.
  const pct = text.match(/\b(\d{1,3})\s*(?:%|percent|per cent)/);
  if (pct) {
    const value = Number(pct[1]);
    if (value >= 0 && value <= 100) return value;
  }

  const word = text.match(
    /\b(ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\s*(?:%|percent|per cent)/,
  );
  if (word && WORD_NUMBERS[word[1]] !== undefined) return WORD_NUMBERS[word[1]];

  for (const [pattern, value] of PROGRESS_ANCHORS) {
    if (pattern.test(text)) {
      inferred.push('progress_percent');
      return value;
    }
  }
  return null;
}

function extractStatus(text: string): Extraction['status'] {
  for (const [pattern, status] of STATUS_PATTERNS) {
    if (pattern.test(text)) return status;
  }
  return null;
}

function extractDepartment(text: string, departments: string[]): string | null {
  // Seeded departments win over aliases so the workspace stays authoritative.
  for (const dept of departments) {
    if (text.includes(dept.toLowerCase())) return dept;
  }
  for (const [canonical, aliases] of Object.entries(DEPARTMENT_ALIASES)) {
    if (!departments.includes(canonical)) continue;
    for (const alias of aliases) {
      if (new RegExp(`\\b${alias}\\b`).test(text)) return canonical;
    }
  }
  return null;
}

function extractDeadline(text: string): string | null {
  for (const pattern of DEADLINE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return null;
}

/** Loose containment match - the UI selector remains authoritative. */
function matchFromList(text: string, candidates: string[]): string | null {
  let best: string | null = null;
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (text.includes(lower)) {
      if (!best || candidate.length > best.length) best = candidate;
      continue;
    }
    // Match on distinctive words (4+ chars) when the full name is not present.
    const words = lower.split(/\s+/).filter((w) => w.length >= 4);
    if (words.length >= 2 && words.every((w) => text.includes(w))) {
      if (!best || candidate.length > best.length) best = candidate;
    }
  }
  return best;
}

export function extractWithRules(text: string, ctx: ExtractionContext): Extraction {
  const trimmed = text.trim();
  if (trimmed.length < 3) return emptyExtraction();

  const lower = normalize(trimmed);
  const inferred: string[] = [];

  const status = extractStatus(lower);
  const progress = extractProgress(lower, inferred);
  const blocker = captureAfter(lower, BLOCKER_MARKERS);
  const department = extractDepartment(lower, ctx.departments);
  const help = captureAfter(lower, HELP_MARKERS);
  const risk = captureAfter(lower, RISK_MARKERS);
  const deadline = extractDeadline(lower);
  const project = matchFromList(lower, ctx.projects);
  const task = matchFromList(lower, ctx.tasks);

  const extraction: Extraction = {
    project,
    task,
    progress_percent: progress,
    status,
    blocker,
    dependency_department: department,
    help_needed: help,
    deadline_text: deadline,
    risk,
    needs_clarification: false,
    clarification_question: null,
    inferred_fields: inferred,
  };

  const question = clarificationFor(extraction);
  if (question) {
    extraction.needs_clarification = true;
    extraction.clarification_question = question;
  }

  return extraction;
}

/**
 * Decides whether to ask rather than guess. Order matters - the most
 * actionable gap is asked about first, and only one question is ever asked.
 */
function clarificationFor(e: Extraction): string | null {
  if (e.status === 'blocked' && !e.dependency_department && !e.blocker) {
    return 'You mentioned you are blocked - what is blocking you, and which team or person are you waiting on?';
  }
  if (e.status === 'blocked' && !e.dependency_department) {
    return 'You mentioned you are blocked - which team or person are you waiting on?';
  }
  if (e.status === 'blocked' && !e.help_needed) {
    return 'What specifically do you need from them to get unblocked?';
  }
  if (e.deadline_text && !e.status) {
    return `You mentioned "${e.deadline_text}" - is this on track to make it, or at risk?`;
  }
  if (!e.status && e.progress_percent === null) {
    return 'I could not tell how this is going. Is it on track, at risk, or blocked?';
  }
  return null;
}

export const rulesProvider: AiProvider = {
  id: 'rules',
  label: 'Rules (local)',
  async extractUpdate(text, ctx) {
    return extractWithRules(text, ctx);
  },
};
