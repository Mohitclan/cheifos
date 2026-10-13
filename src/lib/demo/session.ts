import 'server-only';
import { cookies } from 'next/headers';
import { getCeo, getUser, getUsers, type UserRow } from '@/lib/db/queries';

/**
 * Demo identity switching. THIS IS NOT AUTHENTICATION and the UI says so on
 * every page.
 *
 * A cookie holds the id of the identity being viewed. There is no password,
 * no session token and no authorisation check - anyone can become anyone.
 * That is acceptable for a local demo on fictional data and unacceptable for
 * anything else, which is why the production-auth warning is permanent rather
 * than dismissible. Real authentication is a v1.2 item and removing role
 * switching is part of it.
 */

const COOKIE = 'chiefos_identity';

export async function getCurrentUser(): Promise<UserRow | undefined> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  const id = raw ? Number(raw) : NaN;

  if (Number.isInteger(id)) {
    const user = getUser(id);
    if (user) return user;
  }
  // Default view is the CEO: the Command Center is the opening beat.
  return getCeo();
}

/** The identity a surface requires, regardless of the cookie. */
export async function getUserForRole(role: 'ceo' | 'employee'): Promise<UserRow | undefined> {
  const current = await getCurrentUser();
  if (current?.role === role) return current;
  if (role === 'ceo') return getCeo();
  return getUsers().find((u) => u.role === 'employee');
}

export async function setIdentity(userId: number): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, String(userId), { httpOnly: true, sameSite: 'lax', path: '/' });
}
