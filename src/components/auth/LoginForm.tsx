'use client';

import { useActionState } from 'react';
import { LogIn } from 'lucide-react';
import { login, type LoginResult } from '@/lib/auth/actions';

/**
 * Sign-in form.
 *
 * The demo credentials are shown on screen on purpose: this is a fictional
 * workspace and nobody should have to dig through a seed file to open it.
 * A real deployment removes this block along with the seeded accounts.
 */
export function LoginForm({ seeded }: { seeded: boolean }) {
  const [result, formAction, pending] = useActionState<LoginResult | null, FormData>(login, null);

  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900 p-6">
      <h1 className="text-base font-semibold text-white">Sign in</h1>
      <p className="mt-1 text-xs text-navy-300">
        Your workspace depends on your role. CEO accounts open the Command Center; team accounts
        open their own workspace.
      </p>

      <form action={formAction} className="mt-5 space-y-3">
        <div>
          <label htmlFor="username" className="mb-1 block text-xs font-medium text-navy-200">
            Username
          </label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            autoFocus
            required
            className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-sm text-white outline-none placeholder:text-navy-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/25"
            placeholder="rohan"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-xs font-medium text-navy-200">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-sm text-white outline-none placeholder:text-navy-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/25"
          />
        </div>

        {result && !result.ok && (
          <p role="alert" className="rounded-lg bg-blocked-100 px-3 py-2 text-xs text-blocked-700">
            {result.message}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50"
        >
          <LogIn size={15} aria-hidden />
          {pending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      {seeded ? (
        <div className="mt-5 border-t border-navy-800 pt-4">
          <p className="text-[11px] font-medium text-navy-300">Demo accounts</p>
          <dl className="mt-1.5 space-y-1 text-[11px] text-navy-400">
            <div className="flex justify-between gap-3">
              <dt>CEO</dt>
              <dd className="font-mono text-navy-200">rohan / ceo-demo-2026</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Team</dt>
              <dd className="font-mono text-navy-200">aanya / team-demo-2026</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="mt-5 border-t border-navy-800 pt-4 text-[11px] text-risk-500">
          No workspace yet. Run <span className="font-mono">npm run seed</span> to create the
          fictional demo data and its accounts.
        </p>
      )}
    </div>
  );
}
