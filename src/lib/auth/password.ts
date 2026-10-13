import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt from Node's own crypto module.
 *
 * scrypt is deliberately slow and memory-hard, which is the point: it makes
 * guessing expensive. No dependency is needed - bcrypt and argon2 are both
 * fine choices but both are native modules, and this project avoids native
 * builds on purpose.
 *
 * Stored format: scrypt$N$salt$hash, all hex. The parameters travel with the
 * hash so they can be raised later without invalidating existing passwords.
 */

const KEY_LENGTH = 64;
const COST = 16384; // 2^14. Roughly 100ms here; raise for production.

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: COST }).toString('hex');
  return `scrypt$${COST}$${salt}$${derived}`;
}

/**
 * Constant-time comparison. A plain === would leak how much of the hash
 * matched through timing, which is enough to recover it byte by byte.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

  const cost = Number(parts[1]);
  const salt = parts[2];
  const expected = Buffer.from(parts[3], 'hex');
  if (!Number.isInteger(cost) || expected.length !== KEY_LENGTH) return false;

  try {
    const derived = scryptSync(password, salt, KEY_LENGTH, { N: cost });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
