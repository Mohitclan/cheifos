import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * Signed session cookies.
 *
 * The cookie holds the user id and an expiry, signed with HMAC-SHA256. Editing
 * either value invalidates the signature, so a user cannot promote themselves
 * to CEO by changing a number - which is exactly what the previous demo
 * identity cookie allowed.
 *
 * This is a session cookie, not a token store: there is no server-side
 * revocation list. Fine at this size; a real deployment wants sessions in the
 * database so sign-out everywhere and forced logout are possible.
 */

const COOKIE = 'chiefos_session';
const MAX_AGE_SECONDS = 60 * 60 * 12;

function secret(): string {
  const fromEnv = process.env.CHIEFOS_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CHIEFOS_SESSION_SECRET must be set (16+ characters) before running in production.',
    );
  }
  // Development only, and deliberately obvious in the source.
  return 'chiefos-development-secret-not-for-production';
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

function verify(payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(payload), 'hex');
  const given = Buffer.from(signature, 'hex');
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

export async function createSession(userId: number): Promise<void> {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${userId}.${expires}`;
  const store = await cookies();

  store.set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  });
}

/** The signed-in user id, or null. Returns null for tampered or stale cookies. */
export async function readSession(): Promise<number | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;

  const parts = raw.split('.');
  if (parts.length !== 3) return null;

  const [idPart, expiresPart, signature] = parts;
  if (!verify(`${idPart}.${expiresPart}`, signature)) return null;

  const expires = Number(expiresPart);
  const id = Number(idPart);
  if (!Number.isInteger(id) || !Number.isFinite(expires) || Date.now() > expires) return null;

  return id;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
