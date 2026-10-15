'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, MessageCircleQuestion, X } from 'lucide-react';
import { toast } from 'sonner';
import { approveDecision, requestClarification } from '@/lib/actions';
import type { AnswerCard } from '@/lib/chief/ask';
import { Pill } from '@/components/ui';

/**
 * The records an answer is about, rendered as themselves.
 *
 * Asking should bring you the thing, not a paragraph describing it - so the
 * assistant returns rows and this renders them, with whatever action that row
 * actually supports attached to it.
 *
 * The action is always two presses. The first reveals the exact text that
 * would be sent; the second sends it. A one-press "approve" from a
 * conversational surface would quietly undo the guarantee the whole product
 * rests on, which is that nothing leaves without someone reading it first.
 */

const TONE_BAR: Record<AnswerCard['tone'], string> = {
  blocked: 'border-l-blocked-500',
  risk: 'border-l-risk-500',
  ok: 'border-l-ok-500',
  accent: 'border-l-accent-500',
  neutral: 'border-l-line-strong',
};

export function AnswerCards({ cards, ceoId }: { cards: AnswerCard[]; ceoId: number }) {
  if (cards.length === 0) return null;

  return (
    <ul className="mt-3 space-y-2">
      {cards.map((card) => (
        <li key={card.id}>
          <CardRow card={card} ceoId={ceoId} />
        </li>
      ))}
    </ul>
  );
}

function CardRow({ card, ceoId }: { card: AnswerCard; ceoId: number }) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(kind: 'approve' | 'clarify') {
    if (!card.action) return;
    const form = new FormData();
    form.set('blockerId', String(card.action.blockerId));
    form.set('ceoId', String(ceoId));
    form.set('response', card.action.preview);

    startTransition(async () => {
      const result =
        kind === 'approve' ? await approveDecision(form) : await requestClarification(form);
      if (result.ok) {
        setDone(true);
        setConfirming(false);
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className={`rounded-lg border border-line border-l-[3px] bg-surface px-3.5 py-3 ${TONE_BAR[card.tone]}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-semibold text-ink-900">{card.title}</p>
          {card.subtitle && <p className="mt-0.5 text-xs text-ink-500">{card.subtitle}</p>}
        </div>
        {card.meta && <span className="shrink-0 text-xs text-ink-400">{card.meta}</span>}
      </div>

      {card.body && <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{card.body}</p>}

      {done ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-ok-700">
          <Check size={13} aria-hidden /> Sent. The blocker stays open until someone resolves it.
        </p>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {card.action && !confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md bg-navy-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-navy-800"
            >
              {card.action.label}
            </button>
          )}
          {card.href && (
            <Link
              href={card.href}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent-700 hover:underline"
            >
              Open <ArrowUpRight size={12} aria-hidden />
            </Link>
          )}
        </div>
      )}

      {/* The exact text, before anything is sent. Never behind the button. */}
      {card.action && confirming && !done && (
        <div className="mt-2.5 rounded-lg border border-line bg-panel p-3">
          <p className="mb-1.5 text-[11px] font-semibold text-ink-400">
            This is exactly what will be sent
          </p>
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-ink-700">
            {card.action.preview}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run('approve')}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
            >
              <Check size={13} aria-hidden />
              {pending ? 'Sending...' : 'Send it'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run('clarify')}
              className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:border-ink-300 disabled:opacity-50"
            >
              <MessageCircleQuestion size={13} aria-hidden /> Ask for clarification
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex items-center gap-1 text-xs text-ink-400 hover:underline"
            >
              <X size={12} aria-hidden /> Cancel
            </button>
          </div>

          <p className="mt-2 text-[11px] text-ink-400">
            To edit the wording first, open it in the Decision Inbox.
          </p>
        </div>
      )}

      {card.kind === 'blocker' && !card.action && !done && (
        <p className="mt-2">
          <Pill tone="neutral">No draft yet — open it to write one</Pill>
        </p>
      )}
    </div>
  );
}
