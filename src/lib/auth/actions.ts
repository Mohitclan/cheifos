'use server';

import { redirect } from 'next/navigation';
import { audit, nowIso, run, tx } from '@/lib/db';
import { getUserByUsername } from '@/lib/db/queries';
import { verifyPassword } from './password';
import { createSession, destroySession } from './session';
import { homeFor } from './guard';

export interface LoginResult {
  ok: boolean;
  message?: string;
}

/**
 * Sign in.
 *
 * One message for every failure - unknown username, wrong password, account
 * with no password set. Saying "no such user" tells an attacker which names
 * are real, and that is a free half of the problem solved for them.
 */
export async function login(_prev: LoginResult | null, form: FormData): Promise<LoginResult> {
  const username = String(form.get('username') ?? '').trim();
  const password = String(form.get('password') ?? '');

  if (!username || !password) {
    return { ok: false, message: 'Enter your username and password.' };
  }

  const user = getUserByUsername(username);
  const failure: LoginResult = { ok: false, message: 'That username and password do not match.' };

  if (!user || !user.password_hash) return failure;
  if (!verifyPassword(password, user.password_hash)) {
    // Recorded so a run of failures is visible in the audit trail.
    tx(() => {
      audit({
        actorId: user.id,
        action: 'auth.failed',
        entityType: 'user',
        entityId: user.id,
        summary: `Failed sign-in attempt for ${user.username}.`,
      });
    });
    return failure;
  }

  tx(() => {
    run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
    audit({
      actorId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      summary: `${user.name} signed in as ${user.role === 'ceo' ? 'CEO' : 'team member'}.`,
    });
  });

  await createSession(user.id);
  redirect(homeFor(user));
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect('/login');
}
