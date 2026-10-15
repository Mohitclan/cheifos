import 'server-only';
import { all, audit, nowIso, one, run, tx } from '@/lib/db';
import { getDepartmentNames, getProjects } from '@/lib/db/queries';
import { extractFromForm } from './form';
import { getUpdateSource } from './source';
import type { DayResult, ExternalPerson, ImportReport, UpdateSource } from './types';

/**
 * The sync runner.
 *
 * Reads a day at a time, because none of the sources offer a change feed, and
 * writes what it finds. Safe to run as often as you like - every row is keyed
 * on the source's own id, so re-reading a day updates rather than duplicates.
 *
 * Three rules this file exists to hold.
 *
 * Nothing is invented. An update with no project in the source gets no
 * project here, rather than one guessed from its text.
 *
 * A failed day does not poison the run. Each day is its own transaction, so
 * one bad response leaves the others stored and the error reported.
 *
 * Reading is never writing. There is no code path in this file, or anything
 * it calls, that issues a non-GET request to a source system. The credential
 * cannot enforce that - the estate audit found scopes are stored but not
 * checked - so it is enforced here instead.
 */

/** Re-read window. Updates stay editable upstream, so recent days are swept again. */
const RESWEEP_DAYS = 3;

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  // Guard rather than trust the inputs: a reversed range would loop forever.
  for (let i = 0; i < 400 && cursor <= to; i += 1) {
    out.push(cursor);
    cursor = shiftDays(cursor, 1);
  }
  return out;
}

interface LocalUser {
  id: number;
  external_id: string | null;
}

/**
 * Finds or creates the local person for a source identity.
 *
 * Matched on external_id only. The audit was explicit that email is a label
 * upstream and not a join key - personal addresses, inconsistent casing - so
 * matching on it would merge or split real people.
 */
function resolveUser(person: ExternalPerson): number {
  const existing = one<LocalUser>('SELECT id, external_id FROM users WHERE external_id = ?', [
    person.externalId,
  ]);
  if (existing) {
    run('UPDATE users SET name = ?, email = COALESCE(?, email) WHERE id = ?', [
      person.name,
      person.email,
      existing.id,
    ]);
    return existing.id;
  }

  return run(
    `INSERT INTO users (name, role, email, external_id, is_demo)
     VALUES (?, 'employee', ?, ?, 0)`,
    [person.name, person.email, person.externalId],
  );
}

interface StoredUpdate {
  id: number;
  source_updated_at: string | null;
}

export interface ImportOptions {
  /** Drafts are unfinished writing. Off by default; see types.ts. */
  includeDrafts?: boolean;
}

/** One day. Its own transaction, so a later failure cannot undo it. */
export function importDay(day: DayResult, report: ImportReport, options: ImportOptions = {}): void {
  const departments = getDepartmentNames();
  const projects = getProjects().map((p) => p.name);

  for (const person of day.people) {
    report.peopleSeen += 1;
    const update = person.update;
    if (!update) continue;

    if (update.isDraft && !options.includeDrafts) {
      report.skippedDrafts += 1;
      continue;
    }

    const stored = one<StoredUpdate>(
      'SELECT id, source_updated_at FROM updates WHERE external_id = ?',
      [update.externalId],
    );

    // Unchanged upstream since we last read it - nothing to do.
    if (stored && stored.source_updated_at === update.updatedAt) {
      report.unchanged += 1;
      continue;
    }

    const extraction = extractFromForm(update.fields, {
      departments,
      projects,
      tasks: [],
    });

    try {
      tx(() => {
        const userId = resolveUser(person);

        if (stored) {
          run(
            `UPDATE updates
                SET original_text = ?, extracted_json = ?, source_updated_at = ?, is_draft = ?
              WHERE id = ?`,
            [
              update.originalText,
              JSON.stringify(extraction),
              update.updatedAt,
              update.isDraft ? 1 : 0,
              stored.id,
            ],
          );
          audit({
            actorId: null,
            action: 'update.reimported',
            entityType: 'update',
            entityId: stored.id,
            summary: `${person.name} edited their update for ${update.date} upstream; re-read.`,
            metadata: { externalId: update.externalId },
          });
          report.updated += 1;
          return;
        }

        // project_id is deliberately left null. The source has no project on
        // an update, and reading one out of the prose would be a guess.
        const id = run(
          `INSERT INTO updates (employee_id, project_id, original_text, extracted_json,
                                source, external_id, source_updated_at, is_draft, created_at)
           VALUES (?, NULL, ?, ?, 'imported', ?, ?, ?, ?)`,
          [
            userId,
            update.originalText,
            JSON.stringify(extraction),
            update.externalId,
            update.updatedAt,
            update.isDraft ? 1 : 0,
            update.submittedAt ?? `${update.date}T00:00:00.000Z`,
          ],
        );
        audit({
          actorId: null,
          action: 'update.imported',
          entityType: 'update',
          entityId: id,
          summary: `Imported ${person.name}'s update for ${update.date}.`,
          metadata: { externalId: update.externalId, source: 'external' },
        });
        report.imported += 1;
      });
    } catch (err) {
      report.unmatched.push({
        externalId: update.externalId,
        reason: (err as Error).message,
      });
    }
  }
}

/**
 * Reads a range of days.
 *
 * The health check runs first and a failure stops the run. That is the whole
 * point: an under-privileged key returns an empty list rather than an error,
 * so without this a broken credential looks exactly like a quiet week.
 */
export async function importRange(
  from: string,
  to: string,
  options: ImportOptions = {},
  source: UpdateSource = getUpdateSource(),
): Promise<ImportReport> {
  const report: ImportReport = {
    from,
    to,
    daysRead: 0,
    peopleSeen: 0,
    imported: 0,
    updated: 0,
    unchanged: 0,
    skippedDrafts: 0,
    unmatched: [],
    errors: [],
  };

  if (!source.configured) {
    report.errors.push(`${source.label} is not configured; nothing was read.`);
    return report;
  }

  const health = await source.healthCheck();
  if (!health.ok) {
    report.errors.push(`Health check failed, so nothing was read: ${health.message}`);
    return report;
  }

  for (const date of daysBetween(from, to)) {
    try {
      const day = await source.fetchDay(date);
      importDay(day, report, options);
      report.daysRead += 1;
    } catch (err) {
      report.errors.push(`${date}: ${(err as Error).message}`);
    }
  }

  return report;
}

/**
 * The scheduled sweep: today and the last few days.
 *
 * Re-reading recent days is not belt and braces - it is the only way to catch
 * an edit, because the sources offer no change feed and `updatedAt` is only
 * visible by looking again.
 */
export async function syncRecent(options: ImportOptions = {}): Promise<ImportReport> {
  const today = new Date();
  const to = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return importRange(shiftDays(to, -(RESWEEP_DAYS - 1)), to, options);
}

/** How much has been imported, for the provider chip and the health page. */
export function importedCount(): number {
  const row = one<{ n: number }>("SELECT COUNT(*) AS n FROM updates WHERE source = 'imported'");
  return row ? Number(row.n) : 0;
}

export { all, RESWEEP_DAYS, nowIso };
