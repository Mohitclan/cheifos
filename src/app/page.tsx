import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import {
  getAuditTrail,
  getBlockersForProject,
  getDueSoonTasks,
  getKpis,
  getProjects,
  getRecentUpdates,
  getScheduleForDate,
  getTasksForProject,
  getTopBlockers,
  getUpdatesForProject,
  isSeeded,
} from '@/lib/db/queries';
import { getCurrentUser } from '@/lib/demo/session';
import { getCeo } from '@/lib/db/queries';
import { ago, clock, day, dueLabel, timestamp, todayIso, tomorrowIso } from '@/lib/format';
import {
  AssumptionTag,
  EmptyState,
  KpiCard,
  Panel,
  Pill,
  PriorityPill,
  StatusPill,
  buttonClass,
} from '@/components/ui';
import { SeedPrompt } from '@/components/SeedPrompt';

/** Every number on this page is read from the database on each request. */
export const dynamic = 'force-dynamic';

export default async function CommandCenter() {
  if (!isSeeded()) return <SeedPrompt />;

  const current = await getCurrentUser();
  const ceo = getCeo();
  const kpis = getKpis();
  const projects = getProjects();
  const blockers = getTopBlockers(4);
  const updates = getRecentUpdates(6);
  const activity = getAuditTrail(8);
  const dueSoon = getDueSoonTasks(3);

  const scheduleOwner = ceo?.id ?? current?.id ?? 0;
  const tomorrow = getScheduleForDate(scheduleOwner, tomorrowIso());
  const today = getScheduleForDate(scheduleOwner, todayIso());
  const preview = tomorrow.length ? tomorrow : today;
  const previewIsTomorrow = tomorrow.length > 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Command Center</h1>
          <p className="mt-1 text-sm text-ink-500">
            {day(new Date().toISOString())} - every figure below is computed from records, not entered by hand.
          </p>
        </div>
        <Link href="/decisions" className={buttonClass('primary')}>
          {kpis.awaitingDecision} waiting on you
          <ArrowUpRight size={15} aria-hidden />
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active projects"
          value={kpis.activeProjects}
          note={`${kpis.projectsNeedingAttention} blocked or at risk`}
          tone={kpis.projectsNeedingAttention > 0 ? 'risk' : 'ok'}
        />
        <KpiCard
          label="Open blockers"
          value={kpis.openBlockers}
          note={`${kpis.highPriorityBlockers} high priority`}
          tone={kpis.highPriorityBlockers > 0 ? 'blocked' : 'ok'}
        />
        <KpiCard
          label="Decisions waiting"
          value={kpis.awaitingDecision}
          note={`${kpis.decisionsSentUnacknowledged} sent, not yet acknowledged`}
          tone={kpis.awaitingDecision > 0 ? 'risk' : 'ok'}
        />
        <KpiCard
          label="Updates this week"
          value={kpis.updatesThisWeek}
          note={`${kpis.updatesToday} today - ${kpis.dueSoon} tasks due within 3 days`}
          tone="accent"
        />
      </div>

      <Panel
        title="High-priority blockers"
        subtitle="Each one states why it is prioritised. No score without a reason."
        action={
          <Link href="/decisions" className="text-xs font-semibold text-accent-700 hover:underline">
            Open the Decision Inbox
          </Link>
        }
        bodyClassName="divide-y divide-line"
      >
        {blockers.length === 0 ? (
          <div className="px-5 py-4">
            <EmptyState
              title="Nothing is blocked"
              body="When someone submits an update that flags a blocker, it appears here with its priority reason."
            />
          </div>
        ) : (
          blockers.map((blocker) => (
            <article key={blocker.id} className="px-5 py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <PriorityPill priority={blocker.priority} />
                <StatusPill status={blocker.status} />
                <span className="text-xs font-medium text-ink-500">{blocker.project_name}</span>
                {blocker.dependency_department && (
                  <Pill tone="neutral">Waiting on {blocker.dependency_department}</Pill>
                )}
                <span className="ml-auto text-xs text-ink-400">{ago(blocker.created_at)}</span>
              </div>
              <h3 className="mt-2 text-sm font-semibold text-ink-900">{blocker.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">
                <span className="font-semibold text-ink-700">Why this is prioritised: </span>
                {blocker.priority_reason}
              </p>
              {blocker.raised_by_name && (
                <p className="mt-1.5 text-xs text-ink-400">
                  Raised by {blocker.raised_by_name}
                  {blocker.original_text ? ' from a written update' : ''}
                </p>
              )}
            </article>
          ))
        )}
      </Panel>

      <Panel
        title="Project health"
        subtitle="Open a project to see its tasks, blockers and latest updates."
        bodyClassName="divide-y divide-line"
      >
        {projects.map((project) => {
          const tasks = getTasksForProject(project.id);
          const projectBlockers = getBlockersForProject(project.id);
          const projectUpdates = getUpdatesForProject(project.id, 3);
          const target = dueLabel(project.target_date);

          return (
            <details key={project.id} className="group px-5 py-4 first:pt-0 last:pb-0">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 list-none">
                <StatusPill status={project.status} />
                <span className="text-sm font-semibold text-ink-900">{project.name}</span>
                <span className="text-xs text-ink-400">{project.owner_name}</span>
                {project.open_blockers > 0 && (
                  <Pill tone="blocked">
                    {project.open_blockers} blocker{project.open_blockers === 1 ? '' : 's'}
                  </Pill>
                )}
                {target && (
                  <Pill tone={target.tone === 'neutral' ? 'neutral' : target.tone}>{target.text}</Pill>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <span className="h-1.5 w-28 overflow-hidden rounded-full bg-line">
                    <span
                      className="block h-full rounded-full bg-accent-500"
                      style={{ width: `${Math.min(100, Math.max(0, project.progress))}%` }}
                    />
                  </span>
                  <span className="numeric w-9 text-right text-xs font-semibold text-ink-700">
                    {project.progress}%
                  </span>
                  <span className="text-[11px] font-semibold text-accent-700 group-open:hidden">Open</span>
                  <span className="hidden text-[11px] font-semibold text-accent-700 group-open:inline">Close</span>
                </span>
              </summary>

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div>
                  <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-ink-500 uppercase">Tasks</h4>
                  <ul className="space-y-1.5">
                    {tasks.map((task) => {
                      const due = dueLabel(task.due_date);
                      return (
                        <li key={task.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <StatusPill status={task.status} />
                          <span className="text-ink-700">{task.title}</span>
                          {due && due.tone !== 'neutral' && <Pill tone={due.tone}>{due.text}</Pill>}
                        </li>
                      );
                    })}
                    {tasks.length === 0 && <li className="text-xs text-ink-400">No tasks on this project.</li>}
                  </ul>
                </div>

                <div>
                  <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-ink-500 uppercase">Blockers</h4>
                  {projectBlockers.length === 0 ? (
                    <p className="text-xs text-ink-400">None raised.</p>
                  ) : (
                    <ul className="space-y-2">
                      {projectBlockers.map((blocker) => (
                        <li key={blocker.id} className="text-xs">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <StatusPill status={blocker.status} />
                            <span className="font-medium text-ink-700">{blocker.title}</span>
                          </span>
                          <span className="mt-0.5 block text-ink-400">{blocker.priority_reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-ink-500 uppercase">
                    Latest updates
                  </h4>
                  {projectUpdates.length === 0 ? (
                    <p className="text-xs text-ink-400">No updates yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {projectUpdates.map((update) => (
                        <li key={update.id} className="text-xs">
                          <span className="font-medium text-ink-700">{update.employee_name}</span>
                          <span className="text-ink-400"> - {ago(update.created_at)}</span>
                          <span className="transcript mt-0.5 block text-ink-500">
                            &ldquo;{update.original_text.slice(0, 160)}
                            {update.original_text.length > 160 ? '...' : ''}&rdquo;
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </details>
          );
        })}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title={previewIsTomorrow ? 'Tomorrow at a glance' : 'Today at a glance'}
          subtitle={
            preview.length
              ? 'Assumptions are marked. Nothing here was placed by a model.'
              : 'Nothing planned yet.'
          }
          action={
            <Link href="/schedule" className="text-xs font-semibold text-accent-700 hover:underline">
              Plan the day
            </Link>
          }
        >
          {preview.length === 0 ? (
            <EmptyState
              title="No schedule yet"
              body="Type tomorrow's priorities on the Schedule page. Blocks are proposed, you approve them."
              action={
                <Link href="/schedule" className={buttonClass('secondary')}>
                  Go to Schedule
                </Link>
              }
            />
          ) : (
            <ul className="space-y-2">
              {preview.map((item) => (
                <li key={item.id} className="flex items-start gap-3 rounded-lg border border-line px-3 py-2">
                  <span className="numeric shrink-0 text-xs font-semibold text-ink-700">
                    {clock(item.start_at)}-{clock(item.end_at)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink-900">{item.title}</span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <StatusPill status={item.status} />
                      {item.is_assumed_duration === 1 && <AssumptionTag>assumed length</AssumptionTag>}
                      {item.is_assumed_time === 1 && <AssumptionTag>assumed time</AssumptionTag>}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Recent updates"
          subtitle="Original wording, exactly as submitted."
          action={
            <Link href="/activity" className="text-xs font-semibold text-accent-700 hover:underline">
              Full activity trail
            </Link>
          }
        >
          <ul className="space-y-3">
            {updates.map((update) => (
              <li key={update.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-ink-900">{update.employee_name}</span>
                  <span className="text-ink-400">on {update.project_name}</span>
                  <span className="ml-auto text-ink-400">{timestamp(update.created_at)}</span>
                </div>
                <p className="transcript mt-1 text-ink-600">
                  &ldquo;{update.original_text.slice(0, 180)}
                  {update.original_text.length > 180 ? '...' : ''}&rdquo;
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Due within three days" subtitle="Computed on render - no reminders, nothing to miss.">
          {dueSoon.length === 0 ? (
            <EmptyState title="Nothing due soon" body="No unfinished task has a due date inside three days." />
          ) : (
            <ul className="space-y-2">
              {dueSoon.map((task) => {
                const due = dueLabel(task.due_date);
                return (
                  <li key={task.id} className="flex flex-wrap items-center gap-2 text-xs">
                    {due && <Pill tone={due.tone}>{due.text}</Pill>}
                    <span className="font-medium text-ink-700">{task.title}</span>
                    <span className="text-ink-400">{task.owner_name}</span>
                    <StatusPill status={task.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Recent activity" subtitle="Every state change is recorded with its actor.">
          <ol className="space-y-2">
            {activity.map((entry) => (
              <li key={entry.id} className="flex gap-3 text-xs">
                <span className="numeric w-24 shrink-0 text-ink-400">{timestamp(entry.created_at)}</span>
                <span className="min-w-0">
                  <span className="font-medium text-ink-700">{entry.actor_name ?? 'System'}</span>
                  <span className="text-ink-500"> - {entry.summary}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
