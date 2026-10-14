import Link from 'next/link';
import { requireCeo } from '@/lib/auth/guard';
import { isSeeded } from '@/lib/db/queries';
import { buildComplianceReport, gapLabel } from '@/lib/reporting';
import { day } from '@/lib/format';
import { EmptyState, KpiCard, Panel, Pill } from '@/components/ui';
import { SeedPrompt } from '@/components/SeedPrompt';
import { DownloadCsv } from '@/components/reporting/DownloadCsv';

export const dynamic = 'force-dynamic';

const WINDOWS = [7, 14, 30] as const;

export default async function ReportingPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  await requireCeo();
  if (!isSeeded()) return <SeedPrompt />;

  const params = await searchParams;
  const requested = Number(params.window);
  const windowDays = WINDOWS.includes(requested as (typeof WINDOWS)[number]) ? requested : 14;

  const report = buildComplianceReport(windowDays);
  const behind = report.entries.filter((entry) => entry.severity !== 'ok');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Update reporting</h1>
          <p className="mt-1 text-sm text-ink-500">
            {day(`${report.fromDate}T09:00:00`)} to {day(`${report.toDate}T09:00:00`)} ·{' '}
            {report.expectedDays} working days · weekends are not counted against anyone.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {WINDOWS.map((option) => (
            <Link
              key={option}
              href={`/reporting?window=${option}`}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                option === windowDays
                  ? 'border-accent-600 text-accent-700'
                  : 'border-line-strong text-ink-500 hover:border-ink-300'
              }`}
            >
              {option} days
            </Link>
          ))}
          <DownloadCsv windowDays={windowDays} />
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Filed today"
          value={`${report.filedToday} of ${report.teamSize}`}
          note={report.filedToday === report.teamSize ? 'Everyone is up to date' : 'Counted for today only'}
          tone={report.filedToday === report.teamSize ? 'ok' : 'risk'}
        />
        <KpiCard
          label="Team filing rate"
          value={`${Math.round(report.teamRate * 100)}%`}
          note={`Average across ${report.expectedDays} working days`}
          tone={report.teamRate >= 0.8 ? 'ok' : report.teamRate >= 0.5 ? 'risk' : 'blocked'}
        />
        <KpiCard
          label="Behind"
          value={behind.length}
          note={behind.length ? 'One or more working days without an update' : 'Nobody is behind'}
          tone={behind.length ? 'risk' : 'ok'}
        />
      </div>

      <Panel
        title="By person"
        subtitle="Sorted by filing rate, lowest first. Counted by distinct day, so two updates in one day count once."
        bodyClassName=""
      >
        {report.entries.length === 0 ? (
          <div className="px-5 py-4">
            <EmptyState title="No team members" body="Seed the demo workspace to populate this report." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold text-ink-400">
                  <th className="px-5 py-2.5">Person</th>
                  <th className="px-3 py-2.5">Today</th>
                  <th className="px-3 py-2.5">Days filed</th>
                  <th className="px-3 py-2.5 w-40">Filing rate</th>
                  <th className="px-3 py-2.5">Last filed</th>
                  <th className="px-5 py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {report.entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink-900">{entry.name}</p>
                      <p className="text-xs text-ink-500">
                        {entry.title}
                        {entry.department_name ? ` · ${entry.department_name}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      {entry.filedToday ? (
                        <span className="text-xs font-medium text-ok-700">Filed</span>
                      ) : (
                        <span className="text-xs text-ink-400">Not yet</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-600">
                      {entry.daysFiled} of {entry.expectedDays}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-done-100">
                          <div
                            className={`h-full rounded-full ${
                              entry.rate >= 0.8 ? 'bg-ok-500' : entry.rate >= 0.5 ? 'bg-risk-500' : 'bg-blocked-500'
                            }`}
                            style={{ width: `${Math.round(entry.rate * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-ink-600">{Math.round(entry.rate * 100)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-500">{gapLabel(entry)}</td>
                    <td className="px-5 py-3 text-right">
                      {entry.severity === 'overdue' ? (
                        <Pill tone="blocked">Overdue</Pill>
                      ) : entry.severity === 'watch' ? (
                        <Pill tone="risk">Watch</Pill>
                      ) : (
                        <Pill tone="ok">On track</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-xs text-ink-400">
        This measures whether an update was filed, not what it said. Somebody on approved leave will show as
        behind - the report does not know about leave, and inventing a reason for silence would be worse than
        showing it plainly.
      </p>
    </div>
  );
}
