'use client';

import { useState, useTransition } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { resetDemo } from '@/lib/actions';

/**
 * One-click reset to the seeded state. Used immediately before presenting so
 * the counts on screen match the counts rehearsed with.
 *
 * Confirms first: it drops every record, and doing that by accident mid-demo
 * would be unrecoverable.
 */
export function ResetButton() {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 px-2.5 py-1.5 text-xs font-semibold text-navy-200 transition-colors hover:bg-navy-800 hover:text-white"
      >
        <RotateCcw size={13} aria-hidden /> Reset demo data
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-risk-500/50 bg-navy-800 px-2 py-1 text-xs">
      <span className="text-navy-200">Reseed from scratch?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await resetDemo();
            toast[result.ok ? 'success' : 'error'](result.message);
            setConfirming(false);
          })
        }
        className="rounded bg-accent-600 px-2 py-0.5 font-semibold text-white disabled:opacity-60"
      >
        {pending ? 'Resetting' : 'Yes'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded px-1.5 py-0.5 font-semibold text-navy-200 hover:text-white"
      >
        No
      </button>
    </span>
  );
}
