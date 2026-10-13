'use client';

import { useState, useTransition } from 'react';
import { CalendarCheck, FileText, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  approveSchedule,
  discardScheduleItem,
  proposeSchedule,
  updateScheduleItem,
} from '@/lib/actions';
import { DEMO_SCHEDULE_REQUEST } from '@/lib/demo/constants';
import {
  AssumptionTag,
  Field,
  Notice,
  Panel,
  PriorityPill,
  StatusPill,
  buttonClass,
  inputClass,
} from '@/components/ui';

/**
 * The CEO types priorities; application code places the blocks; the CEO
 * approves. This component is only the controls - the placement logic lives in
 * src/lib/schedule/plan.ts and no model touches it.
 *
 * Conflicts are shown and kept. Editing a block clears its assumption markers,
 * because once a human sets the time it is no longer an assumption.
 */

export interface PlannerItem {
  id: number;
  title: string;
  start_at: string;
  end_at: string;
  priority: 'high' | 'medium' | 'low';
  source_text: string | null;
  is_assumed_duration: number;
  is_assumed_time: number;
  status: 'proposed' | 'approved' | 'discarded';
}

function timeValue(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function SchedulePlanner({
  ownerId,
  planDate,
  items,
  conflicts,
}: {
  ownerId: number;
  planDate: string;
  items: PlannerItem[];
  conflicts: string[];
}) {
  const [request, setRequest] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const proposed = items.filter((item) => item.status === 'proposed');

  function run(action: (form: FormData) => Promise<{ ok: boolean; message: string }>, form: FormData): void {
    startTransition(async () => {
      const outcome = await action(form);
      setResult({ ok: outcome.ok, message: outcome.message });
      toast[outcome.ok ? 'success' : 'error'](outcome.message);
    });
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Tell me the priorities"
        subtitle="Plain text, separated by commas. Times and durations are read from what you write; anything not stated is marked as an assumption."
      >
        <Field label={`Priorities for ${planDate}`}>
          <textarea
            className={`${inputClass} min-h-24 resize-y`}
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="e.g. review the dashboard blocker first thing, sync with Finance at 11 for an hour, pricing review at 11:30, and keep some time for urgent issues"
          />
        </Field>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const form = new FormData();
              form.set('ownerId', String(ownerId));
              form.set('planDate', planDate);
              form.set('request', request);
              run(proposeSchedule, form);
            }}
            className={buttonClass('primary')}
          >
            <Wand2 size={15} aria-hidden />
            {pending ? 'Placing blocks...' : 'Propose a schedule'}
          </button>

          <button
            type="button"
            onClick={() => setRequest(DEMO_SCHEDULE_REQUEST)}
            className={buttonClass('secondary', 'text-xs')}
          >
            <FileText size={14} aria-hidden /> Load sample priorities
          </button>
        </div>

        <p className="mt-2 text-xs text-ink-400">
          Placement and overlap detection are deterministic application code. The parser only proposes candidate
          times - it never decides where a block goes, and it never drops one.
        </p>
      </Panel>

      {conflicts.length > 0 && (
        <div className="rounded-xl border border-blocked-500/40 bg-blocked-100 px-5 py-4">
          <p className="text-[11px] font-semibold text-blocked-700">
            {conflicts.length} overlap{conflicts.length === 1 ? '' : 's'} on this day
          </p>
          <ul className="mt-2 space-y-1.5">
            {conflicts.map((message) => (
              <li key={message} className="text-sm leading-relaxed text-blocked-700">
                {message}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-blocked-700/80">
            Both blocks have been kept. Adjust one below - the system will not choose on your behalf.
          </p>
        </div>
      )}

      <Panel
        title={`Blocks for ${planDate}`}
        subtitle={
          proposed.length > 0
            ? `${proposed.length} proposed, waiting on your approval. Approved blocks persist across navigation and restarts.`
            : 'Everything here is approved and stored.'
        }
        action={
          proposed.length > 0 ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const form = new FormData();
                form.set('ownerId', String(ownerId));
                form.set('planDate', planDate);
                run(approveSchedule, form);
              }}
              className={buttonClass('primary')}
            >
              <CalendarCheck size={15} aria-hidden /> Approve {proposed.length} block
              {proposed.length === 1 ? '' : 's'}
            </button>
          ) : null
        }
        bodyClassName="divide-y divide-line"
      >
        {items.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm text-ink-500">
            No blocks for this day yet. Describe the priorities above and press propose.
          </div>
        ) : (
          items.map((item) => (
            <form
              key={item.id}
              className="px-5 py-4 first:pt-0 last:pb-0"
              action={(formData) => {
                formData.set('ownerId', String(ownerId));
                formData.set('planDate', planDate);
                formData.set('itemId', String(item.id));
                run(updateScheduleItem, formData);
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="numeric text-sm font-semibold text-ink-900">
                  {timeValue(item.start_at)}-{timeValue(item.end_at)}
                </span>
                <StatusPill status={item.status} />
                <PriorityPill priority={item.priority} />
                {item.is_assumed_duration === 1 && <AssumptionTag>assumed length</AssumptionTag>}
                {item.is_assumed_time === 1 && <AssumptionTag>assumed time</AssumptionTag>}
                {item.source_text && (
                  <span className="ml-auto max-w-sm truncate text-xs text-ink-400" title={item.source_text}>
                    from: &ldquo;{item.source_text}&rdquo;
                  </span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1">
                  <Field label="Activity">
                    <input name="title" defaultValue={item.title} className={inputClass} />
                  </Field>
                </div>
                <div className="w-28">
                  <Field label="Start">
                    <input type="time" name="startTime" defaultValue={timeValue(item.start_at)} className={inputClass} />
                  </Field>
                </div>
                <div className="w-28">
                  <Field label="End">
                    <input type="time" name="endTime" defaultValue={timeValue(item.end_at)} className={inputClass} />
                  </Field>
                </div>
                <button type="submit" disabled={pending} className={buttonClass('secondary', 'text-xs')}>
                  Save block
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    const form = new FormData();
                    form.set('ownerId', String(ownerId));
                    form.set('itemId', String(item.id));
                    run(discardScheduleItem, form);
                  }}
                  className={buttonClass('quiet', 'text-xs')}
                >
                  <Trash2 size={14} aria-hidden /> Discard
                </button>
              </div>
            </form>
          ))
        )}
      </Panel>

      {result && <Notice tone={result.ok ? 'ok' : 'error'}>{result.message}</Notice>}
    </div>
  );
}
