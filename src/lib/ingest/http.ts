import type { ExternalUpdate, UpdateSource } from './types';

/**
 * ============================================================================
 *  THIS IS THE FILE TO WRITE WHEN WIRING UP YOUR EXISTING UPDATES SYSTEM.
 * ============================================================================
 *
 * Only two things are needed: the request, and a mapping from whatever the
 * API returns to ExternalUpdate. Nothing else in ChiefOS knows your API exists.
 *
 * TO ENABLE:
 *   1. Fill in fetchSince() below.
 *   2. Set in .env.local:
 *        CHIEFOS_UPDATE_SOURCE=http
 *        CHIEFOS_UPDATES_API_URL=https://...
 *        CHIEFOS_UPDATES_API_KEY=...
 *   3. Run the sync (see lib/ingest/import.ts).
 *
 * RULES THAT MATTER:
 *
 *   - `text` is the person's own words, verbatim. Do not clean it up, do not
 *     summarise it, do not merge several fields into a sentence. The whole
 *     product rests on showing the original beside what was read from it.
 *
 *   - `externalId` must be stable for the same update across calls. If the
 *     API has no id, build one that cannot collide, e.g.
 *     `${userId}:${submittedAt}`. Getting this wrong means duplicates.
 *
 *   - `submittedAt` is when the person wrote it, not when you fetched it.
 *
 *   - Never send ChiefOS data back to the source system. This is read-only.
 *
 *   - The API key stays server-side. This file is never imported by a client
 *     component.
 */

const API_URL = process.env.CHIEFOS_UPDATES_API_URL ?? '';
const API_KEY = process.env.CHIEFOS_UPDATES_API_KEY ?? '';

export const httpSource: UpdateSource = {
  id: 'http',
  label: 'External updates API',
  configured: Boolean(API_URL && API_KEY),

  async fetchSince(since: string): Promise<ExternalUpdate[]> {
    // ---------------------------------------------------------------------
    // IMPLEMENT ME. Sketch for a typical REST endpoint:
    //
    //   const res = await fetch(`${API_URL}/updates?since=${encodeURIComponent(since)}`, {
    //     headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
    //     cache: 'no-store',
    //   });
    //   if (!res.ok) throw new Error(`Updates API returned ${res.status}`);
    //   const body = await res.json();
    //
    //   return body.results.map((row: Record<string, unknown>) => ({
    //     externalId: String(row.id),
    //     authorEmail: (row.user_email as string) ?? null,
    //     authorName: (row.user_name as string) ?? null,
    //     projectName: (row.project as string) ?? null,
    //     text: String(row.body),              // verbatim
    //     submittedAt: String(row.created_at), // ISO 8601
    //   }));
    //
    // Paginate here if the API pages; return every page, oldest first.
    // ---------------------------------------------------------------------
    void since;
    throw new Error('External updates API source is not implemented yet.');
  },
};
