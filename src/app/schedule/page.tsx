import Link from 'next/link';
import { requireCeo } from '@/lib/auth/guard';
import { getScheduleForDate, isSeeded } from '@/lib/db/queries';
import { findRowConflicts } from '@/lib/schedule/plan';
import { WORKDAY } from '@/lib/demo/constants';
import { clock, dayShort, todayIso, tomorrowIso } from '@/lib/format';
import { AssumptionTag, EmptyState, Panel, StatusPill } from '@/components/ui';
import { SeedPrompt } from '@/components/SeedPrompt';
import { SchedulePlanner } from '@/components/schedule/SchedulePlanner';

export const dynamic = 'force-dynamic';

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const signedIn = await requireCeo();
  if (!isSeeded()) return <SeedPrompt />;

  const params = await searchParams;
  const ceo = signedIn;
  const current = signedIn;
  const owner = ceo ?? current;

  if (!owner) {
    return (
      <Panel title="Schedule">
        <EmptyState title="No identity seeded" body="Run npm run seed to create the fictional workspace." />
      </Panel>
    );
  }

  const planDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : tomorrowIso();
  const items = getScheduleForDate(owner.id, planDate);
  const conflicts = findRowConflicts(
    items.map((item) => ({ id: item.id, title: item.title, start_at: item.start_at, end_at: item.end_at })),
  ).map((conflict) => conflict.message);

  const today = getScheduleForDate(owner.id, todayIso());

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Schedule</h1>
          <p className="mt-1 text-sm text-ink-500">
            Planning {dayShort(`${planDate}T09:00:00`)} for {owner.name}. Working day
            {` ${String(WORKDAY.startHour).padStart(2, '0')}:00-${String(WORKDAY.endHour).padStart(2, '0')}:00`}.
          </p>
        </div>
        <nav className="flex gap-2 text-xs font-semibold">
          <Link
            href={`/schedule?date=${todayIso()}`}
            className={`rounded-lg border px-3 py-2 ${
              planDate === todayIso() ? 'border-accent-600 text-accent-700' : 'border-line-strong text-ink-500'
            }`}
          >
            Today
          </Link>
          <Link
            href="/schedule"
            className={`rounded-lg border px-3 py-2 ${
              planDate === tomorrowIso() ? 'border-accent-600 text-accent-700' : 'border-line-strong text-ink-500'
            }`}
          >
            Tomorrow
          </Link>
        </nav>
      </header>

      <SchedulePlanner
        ownerId={owner.id}
        planDate={planDate}
        items={items.map((item) => ({
          id: item.id,
          title: item.title,
          start_at: item.start_at,
          end_at: item.end_at,
          priority: item.priority,
          source_text: item.source_text,
          is_assumed_duration: item.is_assumed_duration,
          is_assumed_time: item.is_assumed_time,
          status: item.status,
        }))}
        conflicts={conflicts}
      />

      {planDate !== todayIso() && today.length > 0 && (
        <Panel title="Today, for reference" subtitle="Already approved and stored.">
          <ul className="space-y-2">
            {today.map((item) => (
              <li key={item.id} className="flex items-start gap-3 text-sm">
                <span className="numeric shrink-0 text-xs font-semibold text-ink-700">
                  {clock(item.start_at)}-{clock(item.end_at)}
                </span>
                <span>
                  <span className="text-ink-900">{item.title}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <StatusPill status={item.status} />
                    {item.is_assumed_duration === 1 && <AssumptionTag>assumed length</AssumptionTag>}
                    {item.is_assumed_time === 1 && <AssumptionTag>assumed time</AssumptionTag>}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
