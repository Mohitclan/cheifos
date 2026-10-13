/**
 * Form-mapping tests, using the real daily-update shape.
 * Run: npm run test:form
 */
import { extractFromForm, isExplicitNo, type DailyUpdateForm } from '../src/lib/ingest/form';
import type { ExtractionContext } from '../src/lib/ai/types';

const ctx: ExtractionContext = {
  departments: ['Finance', 'Legal', 'Design', 'Data', 'Product Engineering'],
  projects: ['Botza', 'Dream Hire', 'Subscription Dashboard'],
  tasks: ['Tour integration', 'Schema sync'],
};

const real: DailyUpdateForm = {
  tasksCompleted: `- Cloned Botza, set it up locally and integrated the tour. The SDK runs only for logged-in users.
- Deployed to live Botza, with data safety as the priority.
- Took a full database backup (67 tables) and verified it by test-restoring it.
- Freed 11 GB of Docker build cache with approval, after checking it was unused.`,
  biggestWin: 'Botza went live safely and a dormant risk that could have wiped a 41k-row table was removed.',
  pendingTasks: 'no',
  plansForTomorrow: 'Run the Dream Hire integration and verify it in the browser. Upload the kit to the Choice server.',
  blockers: 'no',
};

const blocked: DailyUpdateForm = {
  ...real,
  pendingTasks: 'Security follow-ups still open, waiting on the review slot.',
  blockers: 'Waiting on Finance to confirm the subscription status fields before I can finish the integration.',
};

const unanswered: DailyUpdateForm = { ...real, blockers: '' };

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (!condition) failures += 1;
}

console.log('\n  Daily update form mapping\n  ' + '-'.repeat(66) + '\n');

const a = extractFromForm(real, ctx);
check('"no" under blockers is a real answer, not a blocker', a.blocker === null);
check('does not ask about blockers when answered "no"', a.needs_clarification === false,
  a.clarification_question ?? '');
check('status is not blocked', a.status !== 'blocked', String(a.status));

const b = extractFromForm(blocked, ctx);
check('a real blocker is carried verbatim', b.blocker?.startsWith('Waiting on Finance') === true);
check('status becomes blocked', b.status === 'blocked');
check('dependency read from the blocker field', b.dependency_department === 'Finance',
  String(b.dependency_department));
check('pending tasks become risk', b.risk?.startsWith('Security follow-ups') === true);

const c = extractFromForm(unanswered, ctx);
check('an EMPTY blocker field asks, unlike "no"', c.needs_clarification === true,
  c.clarification_question ?? '');

check('isExplicitNo accepts common forms',
  ['no', 'No.', 'none', 'N/A', 'nothing'].every(isExplicitNo));
check('isExplicitNo rejects real content', !isExplicitNo('no access to the staging server'));

console.log('\n  ' + '-'.repeat(66));
console.log(`  GATE: ${failures === 0 ? 'PASSED' : 'FAILED'}  (${failures} failing)\n`);
process.exit(failures === 0 ? 0 : 1);
