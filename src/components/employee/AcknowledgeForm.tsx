'use client';

import { useState, useTransition } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { acknowledgeMessage } from '@/lib/actions';
import { buttonClass, inputClass } from '@/components/ui';

/**
 * Acknowledge received guidance.
 *
 * The wording beside the button is the point: acknowledging says the guidance
 * was read, and nothing else. The blocker stays open until someone explicitly
 * resolves it, which is a separate action taken by a different person.
 */
export function AcknowledgeForm({ messageId, userId }: { messageId: number; userId: number }) {
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-3">
      <input
        className={`${inputClass} text-xs`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Optional reply, e.g. will confirm with Finance this afternoon"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const form = new FormData();
            form.set('messageId', String(messageId));
            form.set('userId', String(userId));
            if (note.trim()) form.set('note', note.trim());
            startTransition(async () => {
              const result = await acknowledgeMessage(form);
              toast[result.ok ? 'success' : 'error'](result.message);
            });
          }}
          className={buttonClass('primary', 'text-xs')}
        >
          <Check size={14} aria-hidden />
          {pending ? 'Acknowledging...' : 'Acknowledge'}
        </button>
        <span className="text-xs text-ink-500">
          Acknowledging records that you read this. It does not resolve the blocker.
        </span>
      </div>
    </div>
  );
}
