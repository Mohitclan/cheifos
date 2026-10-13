'use client';

import { useTransition } from 'react';
import { LogOut } from 'lucide-react';
import { logout } from '@/lib/auth/actions';

/** Who you are, and the way out. Replaces the old demo identity switcher. */
export function SignedInAs({ name, role }: { name: string; role: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <p className="text-[13px] font-medium text-white">{name}</p>
        <p className="text-[10px] text-navy-400">{role === 'ceo' ? 'Chief Executive' : 'Team'}</p>
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => void (await logout()))}
        title="Sign out"
        className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 px-2.5 py-1.5 text-[11px] font-medium text-navy-200 transition-colors hover:border-navy-500 hover:text-white disabled:opacity-50"
      >
        <LogOut size={13} aria-hidden />
        {pending ? 'Signing out...' : 'Sign out'}
      </button>
    </div>
  );
}
