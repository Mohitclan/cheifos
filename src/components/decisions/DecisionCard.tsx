'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, CircleHelp, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { approveDecision, requestClarification, resolveBlocker } from '@/lib/actions';
import { Notice, buttonClass, inputClass } from '@/components/ui';

/**
 * The approval controls for one blocker.
 *
 * Nothing on this card can send on its own. The response is a draft in a
 * textarea until a human presses approve, and the edit the human makes is what
 * gets sent and stored - not the draft it started from.
 */
export function DecisionCard({
  blockerId,
  ceoId,
  draft,
  suggestedQuestion,
  status,
}: {
  blockerId: number;
  ceoId: number;
  draft: string;
  suggestedQuestion: string;
  status: string;
}) {
  const [response, setResponse] = useState(draft);
  const [question, setQuestion] = useState(suggestedQuestion);
  const [askMode, setAskMode] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const edited = response.trim() !== draft.trim();

  function send(action: typeof approveDecision | typeof requestClarification, form: FormData): void {
    startTransition(async () => {
      const outcome = await action(form);
      setResult({ ok: outcome.ok, message: outcome.message });
      toast[outcome.ok ? 'success' : 'error'](outcome.message);
    });
  }

  return (
    <div className="mt-3 space-y-3">
      {!askMode && (
        <>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-ink-400">
              Your response
              <span className="rounded bg-done-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-done-700 normal-case">
                {edited ? 'edited by you' : 'draft, assembled from the update'}
              </span>
            </span>
            <textarea
              className={`${inputClass} min-h-24 resize-y`}
              value={response}
              onChange={(event) => setResponse(event.target.value)}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const form = new FormData();
                form.set('blockerId', String(blockerId));
                form.set('ceoId', String(ceoId));
                form.set('response', response);
                send(approveDecision, form);
              }}
              className={buttonClass('primary')}
            >
              <CheckCircle2 size={15} aria-hidden />
              {pending ? 'Sending...' : 'Approve and send'}
            </button>

            <button
              type="button"
              onClick={() => setAskMode(true)}
              className={buttonClass('secondary', 'text-xs')}
            >
              <CircleHelp size={14} aria-hidden /> Ask for clarification instead
            </button>

            {status === 'decision_sent' && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const form = new FormData();
                  form.set('blockerId', String(blockerId));
                  form.set('actorId', String(ceoId));
                  startTransition(async () => {
                    const outcome = await resolveBlocker(form);
                    setResult({ ok: outcome.ok, message: outcome.message });
                    toast[outcome.ok ? 'success' : 'error'](outcome.message);
                  });
                }}
                className={buttonClass('quiet', 'text-xs')}
              >
                <Lock size={14} aria-hidden /> Mark blocker resolved
              </button>
            )}
          </div>

          <p className="text-xs text-ink-400">
            Approving sends exactly the text above and records who approved it. The blocker moves to
            &ldquo;decision sent&rdquo; - it is not closed until someone resolves it explicitly.
          </p>
        </>
      )}

      {askMode && (
        <>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold text-ink-400">
              Question to send back
            </span>
            <textarea
              className={`${inputClass} min-h-20 resize-y`}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const form = new FormData();
                form.set('blockerId', String(blockerId));
                form.set('ceoId', String(ceoId));
                form.set('question', question);
                send(requestClarification, form);
                setAskMode(false);
              }}
              className={buttonClass('primary')}
            >
              {pending ? 'Sending...' : 'Send question'}
            </button>
            <button type="button" onClick={() => setAskMode(false)} className={buttonClass('quiet', 'text-xs')}>
              Back to the response
            </button>
          </div>
          <p className="text-xs text-ink-400">
            A question is not a decision: the blocker stays where it is and keeps waiting on you.
          </p>
        </>
      )}

      {result && <Notice tone={result.ok ? 'ok' : 'error'}>{result.message}</Notice>}
    </div>
  );
}
