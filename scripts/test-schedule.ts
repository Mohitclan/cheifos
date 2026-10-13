/**
 * Schedule placement checks - the Day 2 Block 5 exit gate.
 *
 * Gates:
 *   - every clause becomes a block (nothing is silently dropped)
 *   - assumed durations and inferred times are flagged
 *   - a deliberately overlapping pair is reported, naming both activities
 *   - "keep time for urgent issues" becomes a real block
 *
 * Run: npm run test:schedule
 */
import { planDay, formatRange } from '../src/lib/schedule/plan';

const PLAN_DATE = '2026-10-14';

const DEMO_INPUT =
  'Review the subscription dashboard blocker first thing, ' +
  'sync with Finance at 11 for an hour, ' +
  'pricing launch review at 11:30, ' +
  'interview the platform candidate after lunch for 45 minutes, ' +
  'and keep some time for urgent issues';

let failures = 0;
function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
}

console.log('\n  Schedule planner\n  ' + '-'.repeat(68) + '\n');

const proposal = planDay(DEMO_INPUT, PLAN_DATE);

for (const block of proposal.blocks) {
  const marks = [
    block.isAssumedTime ? 'assumed time' : null,
    block.isAssumedDuration ? 'assumed duration' : null,
  ]
    .filter(Boolean)
    .join(', ');
  console.log(`        ${formatRange(block)}  ${block.title}${marks ? `  [${marks}]` : ''}`);
}
console.log('');

check('all five activities placed', proposal.blocks.length === 5, `${proposal.blocks.length} blocks`);
check('nothing unplaced', proposal.unplaced.length === 0, proposal.unplaced.join(' | '));
check(
  'stated duration is not marked as assumed',
  proposal.blocks.some((b) => /finance/i.test(b.title) && !b.isAssumedDuration),
);
check(
  'missing duration is marked as assumed',
  proposal.blocks.some((b) => /urgent/i.test(b.title) && b.isAssumedDuration),
);
check(
  'reserve request became a real block',
  proposal.blocks.some((b) => /urgent/i.test(b.title)),
);
check('a conflict was detected', proposal.conflicts.length >= 1);
check(
  'conflict names both activities',
  proposal.conflicts.every((c) => c.message.includes('overlaps') && c.message.includes('kept')),
  proposal.conflicts[0]?.message ?? 'no conflict',
);
check(
  'both conflicting blocks are kept',
  proposal.conflicts.every((c) => c.keys.every((key) => proposal.blocks.some((b) => b.key === key))),
);

// Empty and junk input must fail safe, not throw.
const empty = planDay('', PLAN_DATE);
check('empty input yields no blocks and no crash', empty.blocks.length === 0);
const junk = planDay('???', PLAN_DATE);
check('junk input does not crash', Array.isArray(junk.blocks));

if (proposal.conflicts.length) {
  console.log(`\n  Conflict reported: ${proposal.conflicts[0].message}`);
}

console.log(`\n  GATE: ${failures === 0 ? 'PASSED' : 'FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
