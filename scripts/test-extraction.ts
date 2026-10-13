/**
 * Extraction test corpus - the Day 1 Block 3 exit gate.
 *
 * Gate: at least 4 of these parse usefully, AND every remaining one asks a
 * question rather than inventing a value. A fabricated field is a FAILURE even
 * if everything else passes.
 *
 * Run: npm run test:extract
 */
import { extractWithRules } from '../src/lib/ai/rules';
import type { Extraction, ExtractionContext } from '../src/lib/ai/types';

const ctx: ExtractionContext = {
  departments: ['Finance', 'Legal', 'Design', 'Data', 'Product Engineering'],
  projects: ['Subscription Dashboard', 'Pricing Page Revamp', 'Auth Refactor', 'Data Migration', 'Mobile Onboarding'],
  tasks: ['API integration', 'Schema review', 'Event naming', 'Billing fields'],
};

interface Case {
  name: string;
  text: string;
  /** Fields that must be populated for this case to count as "parsed usefully". */
  expect?: Partial<Record<keyof Extraction, unknown>>;
  /** True when the correct behaviour is to ask rather than answer. */
  mustAsk?: boolean;
}

const CASES: Case[] = [
  {
    name: '1. Scripted demo sentence',
    text: "The dashboard API integration is about 70% done. I'm blocked because I still need Finance to confirm the subscription status fields. I need a decision today to finish the integration.",
    expect: { progress_percent: 70, status: 'blocked', dependency_department: 'Finance' },
  },
  {
    name: '2. Informal, no percentage, different dependency',
    text: "Pricing page is basically ready but I'm waiting on legal.",
    expect: { status: 'blocked', dependency_department: 'Legal' },
  },
  {
    name: '3. Complete, no blocker',
    text: 'Shipped the auth refactor, no issues.',
    expect: { status: 'done' },
  },
  {
    name: '4. Lexical progress, at risk',
    text: 'Halfway through the migration, might slip past Friday.',
    expect: { progress_percent: 50, status: 'at_risk' },
  },
  {
    name: '5. Vague - MUST ask',
    text: 'Still stuck on the same thing as last week.',
    mustAsk: true,
  },
  {
    name: '6. Help needed + dependency, no progress figure',
    text: 'Need someone from Data to confirm the event names before I can finish.',
    expect: { dependency_department: 'Data' },
  },
  {
    name: '7a. Single word - must fail safe',
    text: 'ok',
    mustAsk: true,
  },
  {
    name: '7b. Empty string - must fail safe',
    text: '',
    mustAsk: true,
  },
];

// Fields that must never be populated unless the text supports them.
const FABRICATION_CHECKS: Array<{ field: keyof Extraction; needle: RegExp }> = [
  { field: 'deadline_text', needle: /today|tomorrow|friday|week|eod|monday|tuesday|wednesday|thursday|month|sprint|day/i },
];

let parsedWell = 0;
let askedWhenUnsure = 0;
const failures: string[] = [];

console.log('\n  Extraction corpus\n  ' + '-'.repeat(68) + '\n');

for (const testCase of CASES) {
  const result = extractWithRules(testCase.text, ctx);
  const notes: string[] = [];
  let ok = true;

  if (testCase.mustAsk) {
    if (result.needs_clarification && result.clarification_question) {
      askedWhenUnsure++;
      notes.push(`asks: "${result.clarification_question}"`);
    } else {
      ok = false;
      failures.push(`${testCase.name}: should have asked a question, but did not`);
    }
  }

  if (testCase.expect) {
    const missed: string[] = [];
    for (const [field, want] of Object.entries(testCase.expect)) {
      const got = result[field as keyof Extraction];
      if (got !== want) missed.push(`${field}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
    if (missed.length === 0) {
      parsedWell++;
      const summary = Object.keys(testCase.expect).map((f) => `${f}=${JSON.stringify(result[f as keyof Extraction])}`);
      notes.push(summary.join('  '));
    } else {
      ok = false;
      failures.push(`${testCase.name}: ${missed.join('; ')}`);
    }
  }

  // Fabrication check - the hard gate.
  for (const check of FABRICATION_CHECKS) {
    const value = result[check.field];
    if (typeof value === 'string' && value && !check.needle.test(testCase.text)) {
      ok = false;
      failures.push(`${testCase.name}: FABRICATED ${check.field} = "${value}" (not present in source text)`);
    }
  }

  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${testCase.name}`);
  for (const note of notes) console.log(`        ${note}`);
  console.log('');
}

console.log('  ' + '-'.repeat(68));
console.log(`  Parsed usefully:      ${parsedWell} / ${CASES.filter((c) => c.expect).length}  (gate: >= 4)`);
console.log(`  Asked when unsure:    ${askedWhenUnsure} / ${CASES.filter((c) => c.mustAsk).length}  (gate: all)`);

const fabrications = failures.filter((f) => f.includes('FABRICATED'));
console.log(`  Fabricated fields:    ${fabrications.length}  (gate: 0)`);

if (failures.length) {
  console.log('\n  Failures:');
  for (const failure of failures) console.log(`    - ${failure}`);
}

const gatePassed =
  parsedWell >= 4 &&
  askedWhenUnsure === CASES.filter((c) => c.mustAsk).length &&
  fabrications.length === 0;

console.log(`\n  GATE: ${gatePassed ? 'PASSED' : 'FAILED'}\n`);
process.exit(gatePassed ? 0 : 1);
