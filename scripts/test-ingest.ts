/**
 * Ingest mapping tests, built from the real OwnTasks response shape.
 * Run: npm run test:ingest
 */
import { stripHtml, assembleOriginal } from '../src/lib/ingest/owntasks';
import { extractFromForm, isExplicitNo } from '../src/lib/ingest/form';
import type { ExtractionContext } from '../src/lib/ai/types';

const ctx: ExtractionContext = {
  departments: ['Finance', 'Legal', 'Design', 'Data', 'Product Engineering'],
  projects: ['Botza', 'Dream Hire'],
  tasks: [],
};

let fails = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (!ok) fails += 1;
}

console.log('\n  Ingest mapping\n  ' + '-'.repeat(66) + '\n');

// --- HTML stripping -------------------------------------------------------
check('list markup becomes readable lines',
  stripHtml('<ul><li>Shipped import</li><li>Fixed deploy</li></ul>') === '- Shipped import\n- Fixed deploy');

check('paragraphs separate',
  stripHtml('<p>One</p><p>Two</p>') === 'One\nTwo');

check('entities decode',
  stripHtml('<p>Finance &amp; Legal &quot;signed&quot;</p>') === 'Finance & Legal "signed"');

check('empty stays empty, never becomes null',
  stripHtml('') === '' && stripHtml(undefined) === '');

// This is the distinction the whole mapper rests on.
check('"no" survives stripping as a real answer',
  isExplicitNo(stripHtml('<p>no</p>')), JSON.stringify(stripHtml('<p>no</p>')));

check('empty blockers is NOT an explicit no',
  !isExplicitNo(stripHtml('')));

// --- Original assembly ----------------------------------------------------
const fields = {
  tasksCompleted: '- Deployed Botza\n- Took a backup',
  biggestWin: 'Botza went live safely',
  pendingTasks: 'no',
  plansForTomorrow: 'Dream Hire integration',
  blockers: '',
};

const original = assembleOriginal(fields);
check('all answered fields are kept',
  original.includes('Deployed Botza') && original.includes('Botza went live safely')
  && original.includes('Dream Hire integration'));
check('labels are carried with them',
  original.includes('Biggest win for the day'));
check('an unanswered field is omitted, not blanked',
  !original.includes('Blockers or challenges'));

// --- End to end -----------------------------------------------------------
const e = extractFromForm(fields, ctx);
check('empty blockers still asks rather than assuming', e.needs_clarification === true,
  e.clarification_question ?? '');
check('no blocker invented from the task prose', e.blocker === null);

const blocked = extractFromForm({ ...fields, blockers: '<p>Waiting on Finance to confirm the fields.</p>' }, ctx);
const b = extractFromForm({ ...blocked, blockers: stripHtml('<p>Waiting on Finance to confirm the fields.</p>') }, ctx);
check('a real blocker is read, with its dependency',
  b.status === 'blocked' && b.dependency_department === 'Finance',
  `${b.status} / ${b.dependency_department}`);

console.log('\n  ' + '-'.repeat(66));
console.log(`  GATE: ${fails === 0 ? 'PASSED' : 'FAILED'}  (${fails} failing)\n`);
process.exit(fails === 0 ? 0 : 1);
