import {
  getDepartmentNames,
  getMessagesForUser,
  getProjectsForEmployee,
  getTasksForProject,
  getUpdatesForEmployee,
  getUsers,
  isSeeded,
} from '@/lib/db/queries';
import { getCurrentUser } from '@/lib/demo/session';
import { ago, fieldLabel, timestamp } from '@/lib/format';
import type { Extraction } from '@/lib/ai/types';
import { AssumptionTag, EmptyState, Panel, Pill, StatusPill, Transcript } from '@/components/ui';
import { SeedPrompt } from '@/components/SeedPrompt';
import { UpdateComposer } from '@/components/employee/UpdateComposer';
import { AcknowledgeForm } from '@/components/employee/AcknowledgeForm';

export const dynamic = 'force-dynamic';

/** Fields shown in the summary of a submitted update, in this order. */
const SUMMARY_FIELDS: Array<keyof Extraction> = [
  'status',
  'progress_percent',
  'blocker',
  'dependency_department',
  'help_needed',
  'deadline_text',
  'risk',
];

export default async function EmployeeWorkspace() {
  if (!isSeeded()) return <SeedPrompt />;

  const current = await getCurrentUser();
  const employees = getUsers().filter((u) => u.role === 'employee');
  // The CEO viewing this page writes as the first employee rather than seeing
  // a broken form; the identity switcher in the top bar is how you change it.
  const employee = current?.role === 'employee' ? current : employees[0];

  if (!employee) {
    return (
      <Panel title="Employee Workspace">
        <EmptyState title="No employees seeded" body="Run npm run seed to create the fictional workspace." />
      </Panel>
    );
  }

  const projects = getProjectsForEmployee(employee.id);
  const tasksByProject: Record<number, Array<{ id: number; title: string }>> = {};
  for (const project of projects) {
    tasksByProject[project.id] = getTasksForProject(project.id).map((task) => ({
      id: task.id,
      title: task.title,
    }));
  }

  const messages = getMessagesForUser(employee.id);
  const myUpdates = getUpdatesForEmployee(employee.id, 6);
  const unacknowledged = messages.filter((message) => !message.acknowledged_at).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Employee Workspace</h1>
        <p className="mt-1 text-sm text-ink-500">
          {employee.name} - {employee.title ?? 'Team member'}
          {employee.department ? `, ${employee.department}` : ''}
          {unacknowledged > 0 && (
            <>
              {' - '}
              <span className="font-semibold text-blocked-700">
                {unacknowledged} message{unacknowledged === 1 ? '' : 's'} waiting
              </span>
            </>
          )}
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {projects.length === 0 ? (
            <Panel title="Submit an update">
              <EmptyState
                title="No projects assigned"
                body={`${employee.name} does not own or hold a task on any project, so there is nothing to report on.`}
              />
            </Panel>
          ) : (
            <UpdateComposer
              employeeId={employee.id}
              employeeName={employee.name}
              projects={projects.map((project) => ({ id: project.id, name: project.name }))}
              tasksByProject={tasksByProject}
              departments={getDepartmentNames()}
            />
          )}

          <Panel
            title="Your recent updates"
            subtitle="Your wording is kept exactly as submitted, beside the fields that were read from it."
            bodyClassName="divide-y divide-line"
          >
            {myUpdates.length === 0 ? (
              <div className="px-5 py-4">
                <EmptyState title="Nothing submitted yet" body="Your first update will appear here." />
              </div>
            ) : (
              myUpdates.map((update) => {
                let extraction: Extraction | null = null;
                try {
                  extraction = JSON.parse(update.extracted_json) as Extraction;
                } catch {
                  extraction = null;
                }

                return (
                  <article key={update.id} className="px-5 py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-ink-900">{update.project_name}</span>
                      {update.task_title && <Pill tone="neutral">{update.task_title}</Pill>}
                      {update.source !== 'typed' && <Pill tone="accent">{update.source}</Pill>}
                      <span className="ml-auto text-ink-400">{timestamp(update.created_at)}</span>
                    </div>

                    <div className="mt-2 grid gap-3 lg:grid-cols-2">
                      <Transcript text={update.original_text} />
                      <div className="rounded-lg border border-line px-4 py-3">
                        <p className="mb-2 text-[11px] font-semibold tracking-wider text-ink-500 uppercase">
                          Fields saved with it
                        </p>
                        {extraction === null ? (
                          <p className="text-xs text-ink-400">
                            The stored fields could not be read. Your original wording above is unaffected.
                          </p>
                        ) : (
                          <dl className="space-y-1 text-xs">
                            {SUMMARY_FIELDS.map((key) => {
                              const value = extraction![key];
                              const shown =
                                value === null || value === '' || value === undefined
                                  ? null
                                  : String(value).replace(/_/g, ' ');
                              return (
                                <div key={String(key)} className="flex gap-2">
                                  <dt className="w-28 shrink-0 text-ink-400">{fieldLabel(String(key))}</dt>
                                  <dd className={shown ? 'text-ink-700' : 'text-ink-400 italic'}>
                                    {shown ?? 'not stated'}
                                    {extraction!.inferred_fields.includes(String(key)) && (
                                      <span className="ml-1.5">
                                        <AssumptionTag>inferred</AssumptionTag>
                                      </span>
                                    )}
                                  </dd>
                                </div>
                              );
                            })}
                          </dl>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </Panel>
        </div>

        <Panel
          title="Your inbox"
          subtitle="Guidance approved by the CEO. Acknowledging it does not close the blocker."
          bodyClassName="divide-y divide-line"
        >
          {messages.length === 0 ? (
            <div className="px-5 py-4">
              <EmptyState
                title="No guidance yet"
                body="When the CEO approves a response to something you raised, it arrives here."
              />
            </div>
          ) : (
            messages.map((message) => (
              <article key={message.id} className="px-5 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-ink-900">{message.sender_name}</span>
                  {message.project_name && <span className="text-ink-400">on {message.project_name}</span>}
                  <span className="ml-auto text-ink-400">
                    {message.sent_at ? ago(message.sent_at) : 'not sent'}
                  </span>
                </div>

                {message.blocker_title && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-ink-500">{message.blocker_title}</span>
                    {message.blocker_status && <StatusPill status={message.blocker_status} />}
                  </p>
                )}

                <p className="mt-2 rounded-lg border border-accent-500/30 bg-accent-100/60 px-3 py-2 text-sm leading-relaxed text-ink-900">
                  {message.body}
                </p>

                {message.acknowledged_at ? (
                  <div className="mt-2 text-xs text-ink-500">
                    <span className="font-semibold text-ok-700">Acknowledged</span> {ago(message.acknowledged_at)}
                    {message.ack_note && (
                      <span className="mt-1 block text-ink-500 italic">&ldquo;{message.ack_note}&rdquo;</span>
                    )}
                    {message.blocker_status && message.blocker_status !== 'resolved' && (
                      <span className="mt-1 block text-blocked-700">
                        The blocker is still open - acknowledgement is not resolution.
                      </span>
                    )}
                  </div>
                ) : (
                  <AcknowledgeForm messageId={message.id} userId={employee.id} />
                )}
              </article>
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}
