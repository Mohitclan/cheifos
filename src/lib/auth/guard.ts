import 'server-only';
import { redirect } from 'next/navigation';
import { getUser, type UserRow } from '@/lib/db/queries';
import { readSession } from './session';

/**
 * Server-side authorisation.
 *
 * Hiding a link is not access control. Every page and every write goes through
 * one of these, so a CEO-only action stays CEO-only even if someone posts the
 * form directly. The UI filtering elsewhere is a convenience on top of this,
 * never a substitute for it.
 */

export async function currentUser(): Promise<UserRow | undefined> {
  const id = await readSession();
  if (id === null) return undefined;
  return getUser(id);
}

/** Any signed-in user, or back to the login screen. */
export async function requireUser(): Promise<UserRow> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

/** CEO only. An employee reaching a CEO page lands on their own workspace. */
export async function requireCeo(): Promise<UserRow> {
  const user = await requireUser();
  if (user.role !== 'ceo') redirect('/employee');
  return user;
}

/** The home surface for a role. Used after login and by the root redirect. */
export function homeFor(user: UserRow): string {
  return user.role === 'ceo' ? '/' : '/employee';
}

/**
 * For server actions, which must not redirect mid-write. Returns a result the
 * caller can surface instead of throwing the user to another page.
 */
export async function authorize(
  role?: 'ceo' | 'employee',
): Promise<{ ok: true; user: UserRow } | { ok: false; message: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, message: 'Your session has expired. Sign in again.' };
  if (role && user.role !== role) {
    return { ok: false, message: 'Your account does not have access to that action.' };
  }
  return { ok: true, user };
}
