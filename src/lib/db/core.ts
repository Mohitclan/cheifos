import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';


/**
 * The single point of database access for the whole app.
 *
 * Everything goes through here on purpose: it keeps the persistence choice
 * swappable (see docs - if node:sqlite ever misbehaves, lowdb is a ~20 minute
 * replacement) and it guarantees no query leaks into a client component.
 */

const DB_PATH = process.env.CHIEFOS_DB_PATH ?? path.join(process.cwd(), 'data', 'chiefos.db');

// Next.js re-evaluates modules on hot reload; without this we would open a new
// handle on every edit and eventually exhaust them.
const globalForDb = globalThis as unknown as { __chiefosDb?: DatabaseSync };

function open(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

export function getDb(): DatabaseSync {
  if (!globalForDb.__chiefosDb) {
    globalForDb.__chiefosDb = open();
  }
  return globalForDb.__chiefosDb;
}

/** Drops and recreates every table. Destructive by design; used by seed/reset. */
export function initSchema(db: DatabaseSync = getDb()): void {
  const schemaPath = path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
  db.exec(readFileSync(schemaPath, 'utf8'));
}

type Params = ReadonlyArray<string | number | null | bigint | Uint8Array>;

/**
 * node:sqlite returns rows with a null prototype. React refuses to pass those
 * from a Server Component into a Client Component ("Classes or null prototypes
 * are not supported"), so every row is rehydrated into a plain object here -
 * once, at the boundary, rather than at each call site.
 */
function plain<T>(row: unknown): T {
  return { ...(row as Record<string, unknown>) } as T;
}

/** SELECT returning many rows. */
export function all<T>(sql: string, params: Params = []): T[] {
  return (getDb().prepare(sql).all(...params) as unknown[]).map((row) => plain<T>(row));
}

/** SELECT returning one row, or undefined. */
export function one<T>(sql: string, params: Params = []): T | undefined {
  const row = getDb().prepare(sql).get(...params);
  return row === undefined ? undefined : plain<T>(row);
}

/** INSERT/UPDATE/DELETE. Returns the new rowid for inserts. */
export function run(sql: string, params: Params = []): number {
  const result = getDb().prepare(sql).run(...params);
  return Number(result.lastInsertRowid);
}

/** Scalar helper for the dashboard counts. */
export function count(sql: string, params: Params = []): number {
  const row = one<{ n: number }>(sql, params);
  return row ? Number(row.n) : 0;
}

/**
 * Runs fn inside a transaction. Used so that a state change and its audit row
 * are written together or not at all - an audit trail with gaps is worse than
 * none, because it looks complete.
 */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Every state change records one of these. Call inside the same tx() as the
 * change itself.
 */
export function audit(entry: {
  actorId: number | null;
  action: string;
  entityType: string;
  entityId: number | null;
  summary: string;
  metadata?: unknown;
}): void {
  run(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, summary, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.actorId,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.summary,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      nowIso(),
    ],
  );
}
