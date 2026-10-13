import { requireCeo } from '@/lib/auth/guard';
import { getAuditTrail, isSeeded } from '@/lib/db/queries';
import { timestamp } from '@/lib/format';
import { EmptyState, Panel, Pill } from '@/components/ui';
import { SeedPrompt } from '@/components/SeedPrompt';

export const dynamic = 'force-dynamic';

/**
 * Flat reverse-chronological audit trail. No filters, no search - deliberately.
 *
 * Every row here was written inside the same transaction as the state change
 * it describes, which is why the trail can be trusted to be complete rather
 * than merely to look complete.
 */

/** Groups actions into the coarse categories the colour coding uses. */
function tone(action: string): 'blocked' | 'accent' | 'ok' | 'risk' | 'neutral' {
  if (action.startsWith('blocker.created')) return 'blocked';
  if (action.startsWith('blocker.resolved')) return 'ok';
  if (action.startsWith('blocker')) return 'risk';
  if (action.startsWith('decision.approved') || action.startsWith('message.sent')) return 'accent';
  if (action.startsWith('message.acknowledged')) return 'ok';
  if (action.startsWith('schedule')) return 'accent';
  if (action.startsWith('update.submitted')) return 'neutral';
  return 'neutral';
}

export default async function ActivityPage() {
  await requireCeo();
  if (!isSeeded()) return <SeedPrompt />;

  const trail = getAuditTrail(80);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Activity</h1>
        <p className="mt-1 text-sm text-ink-500">
          Every submission, blocker, approval, send, acknowledgement and schedule change, with its actor and time.
          Written in the same transaction as the change itself.
        </p>
      </header>

      <Panel bodyClassName="px-0 py-0">
        {trail.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyState title="No activity recorded" body="The trail fills as soon as anything happens." />
          </div>
        ) : (
          <ol className="divide-y divide-line">
            {trail.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3">
                <span className="numeric w-28 shrink-0 text-xs text-ink-400">{timestamp(entry.created_at)}</span>
                <Pill tone={tone(entry.action)}>{entry.action.replace(/[._]/g, ' ')}</Pill>
                <span className="min-w-0 flex-1 text-sm text-ink-700">{entry.summary}</span>
                <span className="text-xs text-ink-400">
                  {entry.actor_name ?? 'System'}
                  {entry.actor_role === 'ceo' ? ' (CEO)' : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <p className="text-xs text-ink-400">
        Showing the most recent {trail.length} entries. The demo keeps roughly two weeks of history; nothing is
        ever deleted, only superseded.
      </p>
    </div>
  );
}
