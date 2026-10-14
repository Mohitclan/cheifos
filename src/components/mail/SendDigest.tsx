'use client';

import { useState, useTransition } from 'react';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { sendDigestTo } from '@/lib/actions';
import { Panel, buttonClass, inputClass } from '@/components/ui';

/**
 * Sends one digest, to one address, typed each time.
 *
 * The address is deliberately not remembered. This is the only thing in
 * ChiefOS that leaves the machine, and until there is a verified sending
 * domain and a real scheduler behind it, every send should be a decision
 * rather than a habit.
 */
export function SendDigest({ configured }: { configured: boolean }) {
  const [to, setTo] = useState('');
  const [pending, startTransition] = useTransition();

  function send() {
    const form = new FormData();
    form.set('to', to);

    startTransition(async () => {
      const result = await sendDigestTo(form);
      if (result.ok) {
        toast.success(`Digest sent to ${to}`);
        setTo('');
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Panel
      title="Send a test"
      subtitle={
        configured
          ? 'Sends this digest once, now, to the address you type.'
          : 'Available once a mail provider is configured.'
      }
      bodyClassName="px-5 py-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="you@company.com"
          disabled={!configured || pending}
          className={`${inputClass} max-w-xs disabled:opacity-50`}
        />
        <button
          type="button"
          onClick={send}
          disabled={!configured || pending || to.trim().length === 0}
          className={buttonClass('primary')}
        >
          <Send size={15} aria-hidden />
          {pending ? 'Sending...' : 'Send digest'}
        </button>
      </div>

      <p className="mt-2 text-xs text-ink-400">
        One send, to one address, recorded in the activity trail. Nothing is scheduled and no address is
        stored.
      </p>
    </Panel>
  );
}
