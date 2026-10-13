'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { CircleHelp, FileText, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { previewExtraction, submitUpdate } from '@/lib/actions';
import type { Extraction } from '@/lib/ai/types';
import { DEMO_SAMPLES } from '@/lib/demo/constants';
import {
  AssumptionTag,
  Field,
  Notice,
  Panel,
  Pill,
  Transcript,
  buttonClass,
  inputClass,
} from '@/components/ui';

/**
 * Submit an update, review what was read from it, correct anything, send.
 *
 * The rules this component exists to honour:
 *   - The original wording stays visible beside the extracted fields, before
 *     and after submission.
 *   - Every field is editable, and the edit is what persists. Nothing is
 *     written until the employee presses submit.
 *   - A missing value shows as "not stated", never as a guess. Where the
 *     extractor inferred something it is marked.
 *   - When the extractor cannot tell, its question is shown at the top of the
 *     preview rather than a blank form.
 */

interface ProjectOption {
  id: number;
  name: string;
}

interface TaskOption {
  id: number;
  title: string;
}

const STATUS_OPTIONS = [
  { value: '', label: 'Not stated' },
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk', label: 'At risk' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
];

export function UpdateComposer({
  employeeId,
  employeeName,
  projects,
  tasksByProject,
  departments,
}: {
  employeeId: number;
  employeeName: string;
  projects: ProjectOption[];
  tasksByProject: Record<number, TaskOption[]>;
  departments: string[];
}) {
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState<number | null>(projects[0]?.id ?? null);
  const [taskId, setTaskId] = useState<string>('');
  const [source, setSource] = useState<'typed' | 'sample'>('typed');

  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [providerLabel, setProviderLabel] = useState('');
  const [reviewedText, setReviewedText] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string; detail?: string | null } | null>(null);

  const [previewing, startPreview] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const tasks = useMemo(() => (projectId ? (tasksByProject[projectId] ?? []) : []), [projectId, tasksByProject]);

  const inferred = new Set(extraction?.inferred_fields ?? []);

  function runPreview(): void {
    const value = text.trim();
    if (value.length < 3) {
      toast.error('Write your update first.');
      return;
    }
    setResult(null);
    startPreview(async () => {
      const preview = await previewExtraction({ text: value, employeeId, projectId });
      setExtraction(preview.extraction);
      setProviderLabel(preview.providerLabel);
      setReviewedText(value);
    });
  }

  function onSubmit(formData: FormData): void {
    startSubmit(async () => {
      const outcome = await submitUpdate(formData);
      setResult({ ok: outcome.ok, message: outcome.message, detail: outcome.error ?? null });
      toast[outcome.ok ? 'success' : 'error'](outcome.message);
      if (outcome.ok) {
        setText('');
        setExtraction(null);
        setReviewedText('');
        setSource('typed');
        formRef.current?.reset();
      }
    });
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Submit an update"
        subtitle={`Writing as ${employeeName}. Nothing is saved until you review what was read and press submit.`}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project">
            <select
              className={inputClass}
              value={projectId ?? ''}
              onChange={(event) => {
                setProjectId(Number(event.target.value));
                setTaskId('');
              }}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Task" hint="Optional. The selector is authoritative, not the text.">
            <select className={inputClass} value={taskId} onChange={(event) => setTaskId(event.target.value)}>
              <option value="">No specific task</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Your update" hint="Write it the way you would say it in a standup.">
            <textarea
              className={`${inputClass} min-h-28 resize-y`}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setSource('typed');
              }}
              placeholder="e.g. API integration is about 70% done, but I am blocked waiting on Finance to confirm the subscription status fields."
            />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={runPreview} disabled={previewing} className={buttonClass('primary')}>
            <Sparkles size={15} aria-hidden />
            {previewing ? 'Reading your update...' : 'Check what this says'}
          </button>

          {DEMO_SAMPLES.map((sample) => (
            <button
              key={sample.label}
              type="button"
              onClick={() => {
                setText(sample.text);
                setSource('sample');
                setExtraction(null);
              }}
              className={buttonClass('secondary', 'text-xs')}
            >
              <FileText size={14} aria-hidden />
              {sample.label}
            </button>
          ))}

        </div>

        <p className="mt-2 text-xs text-ink-400">
          Extraction runs locally on a rules engine. It returns only what your text actually says - anything it
          cannot find it leaves empty or asks about.
        </p>
      </Panel>

      {extraction && (
        <form ref={formRef} action={onSubmit}>
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="projectId" value={projectId ?? ''} />
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="originalText" value={reviewedText} />
          <input type="hidden" name="source" value={source} />
          <input type="hidden" name="field_inferred" value={extraction.inferred_fields.join(',')} />
          <input
            type="hidden"
            name="field_needs_clarification"
            value={String(extraction.needs_clarification)}
          />
          <input
            type="hidden"
            name="field_clarification_question"
            value={extraction.clarification_question ?? ''}
          />

          <Panel
            title="What was read from your update"
            subtitle={`Provider: ${providerLabel}. Correct anything - what you leave here is what gets saved.`}
          >
            {extraction.needs_clarification && extraction.clarification_question && (
              <div className="mb-4 rounded-lg border border-risk-500/50 bg-risk-100 px-4 py-3">
                <p className="flex items-center gap-2 text-[11px] font-semibold text-risk-700">
                  <CircleHelp size={14} aria-hidden /> One question before this is useful
                </p>
                <p className="mt-1.5 text-sm font-medium text-risk-700">{extraction.clarification_question}</p>
                <p className="mt-1.5 text-xs text-risk-700/80">
                  Nothing has been invented to fill the gap. Answer it in the fields below, or edit your update and
                  check again.
                </p>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Status">
                  <select name="field_status" defaultValue={extraction.status ?? ''} className={inputClass}>
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Progress %"
                  tag={inferred.has('progress_percent') ? <AssumptionTag>inferred</AssumptionTag> : null}
                  hint={
                    inferred.has('progress_percent')
                      ? 'Read from wording rather than a number you gave. Change it if it is wrong.'
                      : undefined
                  }
                >
                  <input
                    type="number"
                    min={0}
                    max={100}
                    name="field_progress"
                    defaultValue={extraction.progress_percent ?? ''}
                    placeholder="Not stated"
                    className={inputClass}
                  />
                </Field>

                <Field label="Blocker">
                  <input
                    name="field_blocker"
                    defaultValue={extraction.blocker ?? ''}
                    placeholder="Not stated"
                    className={inputClass}
                  />
                </Field>

                <Field label="Waiting on">
                  <select
                    name="field_dependency"
                    defaultValue={extraction.dependency_department ?? ''}
                    className={inputClass}
                  >
                    <option value="">Not stated</option>
                    {departments.map((department) => (
                      <option key={department} value={department}>
                        {department}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Help needed">
                  <input
                    name="field_help"
                    defaultValue={extraction.help_needed ?? ''}
                    placeholder="Not stated"
                    className={inputClass}
                  />
                </Field>

                <Field
                  label="Stated timing"
                  hint="Stored as you wrote it. No date is resolved on your behalf."
                >
                  <input
                    name="field_deadline"
                    defaultValue={extraction.deadline_text ?? ''}
                    placeholder="Not stated"
                    className={inputClass}
                  />
                </Field>

                <div className="sm:col-span-2">
                  <Field label="Risk">
                    <input
                      name="field_risk"
                      defaultValue={extraction.risk ?? ''}
                      placeholder="Not stated"
                      className={inputClass}
                    />
                  </Field>
                </div>
              </div>

              <div className="space-y-3">
                <Transcript text={reviewedText} />
                <div className="rounded-lg border border-line bg-surface px-4 py-3 text-xs text-ink-500">
                  <p className="font-semibold text-ink-700">What happens on submit</p>
                  <ul className="mt-1.5 space-y-1">
                    <li>Your wording is stored unchanged and stays visible.</li>
                    <li>If the status is blocked, a blocker is raised with a stated priority reason.</li>
                    <li>A draft response goes to the CEO. Nothing is sent without their approval.</li>
                  </ul>
                </div>
                {extraction.project && (
                  <p className="text-xs text-ink-400">
                    Matched project from your text: <Pill tone="accent">{extraction.project}</Pill>
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="submit" disabled={submitting} className={buttonClass('primary')}>
                <Send size={15} aria-hidden />
                {submitting ? 'Submitting...' : 'Submit update'}
              </button>
              <button
                type="button"
                onClick={() => setExtraction(null)}
                className={buttonClass('quiet', 'text-xs')}
              >
                Back to editing
              </button>
            </div>
          </Panel>
        </form>
      )}

      {result && (
        <Notice tone={result.ok ? 'ok' : 'error'} detail={result.detail}>
          {result.message}
        </Notice>
      )}
    </div>
  );
}
