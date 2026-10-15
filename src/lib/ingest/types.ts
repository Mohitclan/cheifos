import type { DailyUpdateForm } from './form';

/**
 * Reading updates from the systems people already use.
 *
 * The contract is A DAY, not a cursor. That is not a simplification - it is
 * what the sources actually offer. OwnTasks has no `since` filter, no cursor
 * and no pagination on its update endpoints, so a caller has to loop days
 * whatever the interface promises. An interface that promised a delta would
 * be a lie the adapter had to work around.
 *
 * A day also carries PEOPLE, not just updates. The endpoint returns everyone
 * expected to report alongside their update or null, so non-submitters come
 * free - and "who went quiet" is the one thing a dashboard built from
 * submitted work can never show.
 */

/** One person on one day, with whatever they filed. */
export interface ExternalPerson {
  /** Identity in the source system. The join key - never email. */
  externalId: string;
  name: string;
  /** A label, not a key. Personal addresses and inconsistent casing abound. */
  email: string | null;
  /**
   * Whether the source considers them a current member. `null` means the
   * source could not tell us - treat as unknown, never as "not an employee",
   * or one upstream outage renders the whole org as ex-staff.
   */
  isActive: boolean | null;
  /** null means no update was submitted that day. Not the same as an empty one. */
  update: ExternalUpdate | null;
}

export interface ExternalUpdate {
  /**
   * Stable id in the source. Used to deduplicate, so re-reading a day cannot
   * create the same update twice. Where the source has no id, build one that
   * cannot collide - `${userId}:${date}` is the usual answer.
   */
  externalId: string;

  /** The day it belongs to, as the source labels it. "YYYY-MM-DD". */
  date: string;

  /** When the person submitted. null while the update is still a draft. */
  submittedAt: string | null;

  /**
   * Last change in the source. The only way to notice a late edit when there
   * is no change feed, so it is compared against what we stored.
   */
  updatedAt: string;

  /** Still being written. Unfinished writing is not a signal for the CEO. */
  isDraft: boolean;

  /** The structured answers, already separated by the source's own form. */
  fields: DailyUpdateForm;

  /**
   * The person's own words, assembled from the fields with their labels and
   * nothing added. Shown beside whatever was read from them, so it must stay
   * verbatim - no cleanup, no summarising, no reordering.
   */
  originalText: string;
}

/** What one day's read returned. */
export interface DayResult {
  date: string;
  people: ExternalPerson[];
}

export interface HealthResult {
  ok: boolean;
  message: string;
}

export interface UpdateSource {
  readonly id: string;
  readonly label: string;
  readonly configured: boolean;

  /**
   * Proves the credential actually works.
   *
   * Required, not optional, because the sources fail silently: an
   * under-privileged OwnTasks key returns `200 {"members":[]}` rather than a
   * 403, which is indistinguishable from "nobody reported today". A source
   * that cannot distinguish those two must say so here.
   */
  healthCheck(): Promise<HealthResult>;

  /** Everyone and their update for one calendar day. */
  fetchDay(date: string): Promise<DayResult>;
}

export interface ImportReport {
  from: string;
  to: string;
  daysRead: number;
  peopleSeen: number;
  imported: number;
  updated: number;
  /** Already stored and unchanged since. */
  unchanged: number;
  /** Drafts left alone. */
  skippedDrafts: number;
  /** Fetched but not attributable to anyone we know about. */
  unmatched: Array<{ externalId: string; reason: string }>;
  errors: string[];
}
