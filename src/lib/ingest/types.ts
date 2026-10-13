/**
 * Ingesting updates from the system employees already use.
 *
 * ChiefOS does not need to be where people write their daily update. If that
 * habit already exists somewhere else, the valuable thing is reading from it -
 * the extraction, the blocker escalation and the decision loop are what this
 * product adds, and none of them care where the text came from.
 *
 * This is the same shape as the AI provider seam: one interface, a default
 * that always works, and a real implementation that drops in behind it.
 */

/** One update as the source system describes it, before any interpretation. */
export interface ExternalUpdate {
  /**
   * This update's id in the source system. Used to deduplicate, so running a
   * sync twice cannot create the same update twice. Required.
   */
  externalId: string;

  /** Whichever the source provides. Matching tries email first, then name. */
  authorEmail?: string | null;
  authorName?: string | null;
  authorExternalId?: string | null;

  /** Free-text project or team label, matched loosely against our projects. */
  projectName?: string | null;

  /** The update itself, exactly as the person wrote it. Never rewrite this. */
  text: string;

  /** ISO 8601. When the person submitted it in the source system. */
  submittedAt: string;
}

export interface UpdateSource {
  readonly id: string;
  /** Shown in the provider chip beside the extraction provider. */
  readonly label: string;
  /** True once the source is configured enough to be called. */
  readonly configured: boolean;
  /**
   * Updates created or changed since `since` (ISO 8601), oldest first.
   * Throwing is fine - the caller reports the failure and keeps the last
   * successful sync point, so nothing is silently skipped.
   */
  fetchSince(since: string): Promise<ExternalUpdate[]>;
}

export interface ImportReport {
  fetched: number;
  imported: number;
  /** Already seen, matched on externalId. */
  skipped: number;
  /** Fetched but not attributable to a person or project we know about. */
  unmatched: Array<{ externalId: string; reason: string }>;
  error?: string;
}
