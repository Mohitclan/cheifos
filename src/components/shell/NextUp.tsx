import Link from 'next/link';
import { CalendarClock, Users } from 'lucide-react';
import type { ScheduleAlert } from '@/lib/alerts';

/**
 * The next thing on the CEO's day, stated in full.
 *
 * Recomputed on every render rather than pushed, so it cannot be stale or
 * silently missed. "In 12 minutes" is calculated at the moment it is read.
 */

const TONE: Record<ScheduleAlert['urgency'], string> = {
  now: 'border-blocked-500/50 bg-blocked-100',
  soon: 'border-risk-500/50 bg-risk-100',
  later: 'border-line bg-panel',
  past: 'border-line bg-panel',
};

const LABEL: Record<ScheduleAlert['urgency'], string> = {
  now: 'Happening now',
  soon: 'Starting shortly',
  later: 'Next up',
  past: 'Earlier today',
};

export function NextUp({ alert }: { alert: ScheduleAlert | null }) {
  if (!alert) return null;

  const isMeeting = alert.item.kind === 'meeting';

  return (
    <aside className={`rounded-xl border px-5 py-4 ${TONE[alert.urgency]}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-ink-500" aria-hidden>
          {isMeeting ? <Users size={17} /> : <CalendarClock size={17} />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-ink-500">{LABEL[alert.urgency]}</p>
          <p className="mt-0.5 text-[15px] leading-snug font-semibold text-ink-900">{alert.headline}</p>

          <ul className="mt-1.5 space-y-0.5 text-xs text-ink-500">
            {alert.context.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <Link
          href="/schedule"
          className="shrink-0 text-xs font-semibold text-accent-700 hover:underline"
        >
          Open the day
        </Link>
      </div>
    </aside>
  );
}
