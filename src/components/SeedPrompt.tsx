import { Panel } from '@/components/ui';

/**
 * Shown when the database has no rows yet - a fresh clone before the seed has
 * run. A real empty state rather than a crashed page: the first thing anyone
 * sees should never be a stack trace.
 */
export function SeedPrompt() {
  return (
    <Panel title="No demo data yet" subtitle="The workspace is empty because the seed has not run.">
      <p className="text-sm leading-relaxed text-ink-700">
        Run the seed once to create the fictional workspace - four departments, five projects, thirty-one updates,
        seven blockers and two weeks of audit history:
      </p>
      <pre className="mt-3 rounded-lg bg-navy-900 px-4 py-3 font-mono text-xs text-navy-200">npm run seed</pre>
      <p className="mt-3 text-xs text-ink-500">
        Then reload this page. The same code runs behind the reset button in the top bar.
      </p>
    </Panel>
  );
}
