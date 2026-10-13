/**
 * CLI entry point for the demo seed.
 *
 *   npm run seed    - create the database and fill it
 *   npm run reset   - identical; the separate script name exists so the
 *                     intent reads clearly in the terminal and in docs
 *
 * The seeding itself lives in src/lib/demo/seed.ts so the reset button inside
 * the app runs exactly the same code. One definition, two callers.
 */
import { getDb } from '../src/lib/db/core';
import { seedDemoWorkspace } from '../src/lib/demo/seed';

seedDemoWorkspace();

const db = getDb();
const tables = [
  'departments',
  'users',
  'projects',
  'tasks',
  'updates',
  'blockers',
  'decisions',
  'messages',
  'schedule_items',
  'audit_logs',
];

console.log('\n  ChiefOS demo workspace seeded (all data is fictional)\n');
for (const table of tables) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  console.log(`    ${table.padEnd(16)} ${row.n}`);
}
console.log('');
