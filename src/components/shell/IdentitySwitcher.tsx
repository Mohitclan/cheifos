'use client';

import { useTransition } from 'react';
import { switchIdentity } from '@/lib/actions';
import type { UserRow } from '@/lib/db/queries';

/**
 * Demo role switching. There is no password and no authorisation check - this
 * is a view selector, which is why it sits next to the production-auth
 * warning rather than pretending to be a login.
 */
export function IdentitySwitcher({ users, currentId }: { users: UserRow[]; currentId: number | null }) {
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2">
      <span className="text-[11px] font-medium text-navy-400">Viewing as</span>
      <select
        aria-label="Switch demo identity"
        className="rounded-lg border border-navy-700 bg-navy-800 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        value={currentId ?? ''}
        disabled={pending}
        onChange={(event) => {
          const form = new FormData();
          form.set('userId', event.target.value);
          startTransition(async () => {
            await switchIdentity(form);
          });
        }}
      >
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} - {user.role === 'ceo' ? 'CEO' : (user.title ?? 'Employee')}
          </option>
        ))}
      </select>
    </label>
  );
}
