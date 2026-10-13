import Link from 'next/link';
import { requireCeo } from '@/lib/auth/guard';
import {
  getCommentsForBlocker,
  getInboxBlockers,
  getResolvedBlockers,
  getSentBlockers,
  isSeeded,
  type BlockerRow,
} from '@/lib/db/queries';
import { ago, fieldLabel, timestamp } from '@/lib/format';
import { emptyExtraction, type Extraction } from '@/lib/ai/types';
import { clarificationRequest, draftResponse } from '@/lib/escalation';
import {
  AssumptionTag,
  EmptyState,
  Panel,
  Pill,
  PriorityPill,
  StatusPill,
  Transcript,
  buttonClass,
} from '@/components/ui';
import { SeedPrompt } from '@/components/SeedPrompt';
import { DecisionCard } from '@/components/decisions/DecisionCard';
import { BlockerComments } from '@/components/decisions/BlockerComments';

export const dynamic = 'force-dynamic';

const EXTRACTION_FIELDS: Array<keyof Extraction> = [
  'status',
  'progress_percent',
  'blocker',
  'dependency_department',
  'help_needed',
  'deadline_text',
  'risk',
];

function parseExtraction(raw: string | null): Extraction | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Extraction;
  } catch {
    return null;
  }
}

export default async function DecisionInbox() {
  const signedIn = await requireCeo();
  if (!isSeeded()) return <SeedPrompt />;

  const ceo = signedIn;
  const inbox = getInboxBlockers();
  const sent = getSentBlockers();
  const resolved = getResolvedBlockers(5);

  if (!ceo) {
    return (
      <Panel title="Decision Inbox">
        <EmptyState title="No CEO identity seeded" body="Run npm run seed to create the fictional workspace." />
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Decision Inbox</h1>
        <p className="mt-1 text-sm text-ink-500">
          {inbox.length} waiting on you, ordered by priority. Each one shows the original wording beside what was
          read from it, and why it is prioritised.
        </p>
      </header>

      {inbox.length === 0 ? (
        <Panel title="Nothing waiting">
          <EmptyState
            title="The inbox is empty"
            body="When someone submits an update that flags a blocker, it arrives here with a draft response for you to edit."
            action={
              <Link href="/employee" className={buttonClass('secondary')}>
                Submit an update as an employee
              </Link>
            }
          />
        </Panel>
      ) : (
        <div className="space-y-5">
          {inbox.map((blocker) => (
            <BlockerPanel key={blocker.id} blocker={blocker} ceoId={ceo.id} actionable />
          ))}
        </div>
      )}

      {sent.length > 0 && (
        <Panel
          title="Decided, not yet closed"
          subtitle="Guidance has been sent. These stay here until someone explicitly resolves them."
          bodyClassName="divide-y divide-line"
        >
          {sent.map((blocker) => (
            <div key={blocker.id} className="px-5 py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={blocker.status} />
                <PriorityPill priority={blocker.priority} />
                <span className="text-xs text-ink-500">{blocker.project_name}</span>
                <span className="ml-auto text-xs text-ink-400">{ago(blocker.created_at)}</span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-ink-900">{blocker.title}</p>
              {blocker.approved_response && (
                <p className="mt-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-ink-700">
                  {blocker.approved_response}
                </p>
              )}
              <DecisionCard
                blockerId={blocker.id}
                ceoId={ceo.id}
                draft={blocker.approved_response ?? blocker.proposed_response ?? ''}
                suggestedQuestion={clarificationRequest({
                  extraction: parseExtraction(blocker.extracted_json) ?? emptyExtraction(),
                  projectName: blocker.project_name,
                })}
                status={blocker.status}
              />
            </div>
          ))}
        </Panel>
      )}

      {resolved.length > 0 && (
        <Panel
          title="Recently resolved"
          subtitle="Kept visible - nothing is deleted, status only ever changes."
          bodyClassName="divide-y divide-line"
        >
          {resolved.map((blocker) => (
            <div key={blocker.id} className="px-5 py-3 text-xs first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={blocker.status} />
                <span className="font-medium text-ink-700">{blocker.title}</span>
                <span className="text-ink-400">{blocker.project_name}</span>
                <span className="ml-auto text-ink-400">
                  {blocker.resolved_at ? `resolved ${ago(blocker.resolved_at)}` : ''}
                </span>
              </div>
              {blocker.approved_response && (
                <p className="mt-1 text-ink-500">{blocker.approved_response}</p>
              )}
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}

function BlockerPanel({
  blocker,
  ceoId,
  actionable,
}: {
  blocker: BlockerRow;
  ceoId: number;
  actionable: boolean;
}) {
  const extraction = parseExtraction(blocker.extracted_json);

  // Where a blocker arrived without a stored draft (seeded or raised outside
  // the update flow), compose one here so the CEO never faces a blank box.
  const draft =
    blocker.approved_response ??
    blocker.proposed_response ??
    (extraction
      ? draftResponse({
          extraction,
          raisedByName: blocker.raised_by_name ?? 'the author',
          projectName: blocker.project_name,
          dependencyDepartment: blocker.dependency_department,
          dependencyContactName: blocker.owner_name,
        })
      : '');

  return (
    <Panel
      title={blocker.title}
      subtitle={`${blocker.project_name} - raised by ${blocker.raised_by_name ?? 'unknown'} ${ago(blocker.created_at)}`}
      action={
        <span className="flex flex-wrap items-center justify-end gap-2">
          <PriorityPill priority={blocker.priority} />
          <StatusPill status={blocker.status} />
          {blocker.decision_status && <StatusPill status={blocker.decision_status} />}
        </span>
      }
    >
      <div className="rounded-lg border border-risk-500/30 bg-risk-100/50 px-4 py-3">
        <p className="text-[11px] font-semibold text-risk-700">Why this is first</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-900">{blocker.priority_reason}</p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          {blocker.original_text ? (
            <Transcript
              text={blocker.original_text}
              label={`Original wording - ${blocker.raised_by_name ?? 'author'}, ${timestamp(
                blocker.update_created_at ?? blocker.created_at,
              )}`}
            />
          ) : (
            <div className="rounded-lg border border-line bg-surface px-4 py-3 text-xs text-ink-500">
              This blocker was recorded directly rather than from a written update, so there is no transcript to
              show. Its description is below.
            </div>
          )}
          {blocker.description && (
            <p className="text-xs leading-relaxed text-ink-600">{blocker.description}</p>
          )}
          <p className="flex flex-wrap gap-2 text-xs">
            {blocker.dependency_department && <Pill tone="neutral">Waiting on {blocker.dependency_department}</Pill>}
            {blocker.owner_name && <Pill tone="accent">Owner {blocker.owner_name}</Pill>}
          </p>
        </div>

        <div className="rounded-lg border border-line px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold text-ink-400">
            Extracted fields, as confirmed by the author
          </p>
          {extraction === null ? (
            <p className="text-xs text-ink-400">
              No extraction is stored for this blocker. The wording and description beside it are unaffected.
            </p>
          ) : (
            <dl className="space-y-1 text-xs">
              {EXTRACTION_FIELDS.map((key) => {
                const value = extraction[key];
                const shown =
                  value === null || value === '' || value === undefined
                    ? null
                    : String(value).replace(/_/g, ' ');
                return (
                  <div key={String(key)} className="flex gap-2">
                    <dt className="w-28 shrink-0 text-ink-400">{fieldLabel(String(key))}</dt>
                    <dd className={shown ? 'text-ink-700' : 'text-ink-400 italic'}>
                      {shown ?? 'not stated'}
                      {extraction.inferred_fields.includes(String(key)) && (
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

      {actionable && (
        <DecisionCard
          blockerId={blocker.id}
          ceoId={ceoId}
          draft={draft}
          suggestedQuestion={clarificationRequest({
            extraction: extraction ?? emptyExtraction(),
            projectName: blocker.project_name,
          })}
          status={blocker.status}
        />
      )}

      <div className="border-t border-line px-5 py-4">
        <BlockerComments
          blockerId={blocker.id}
          authorId={ceoId}
          comments={getCommentsForBlocker(blocker.id)}
        />
      </div>
    </Panel>
  );
}
