import type { DayResult, ExternalPerson, HealthResult, UpdateSource } from './types';
import type { DailyUpdateForm } from './form';

/**
 * OwnTasks.
 *
 * Every failure mode in this source is silent, so most of this file is
 * assertions rather than parsing:
 *
 *   - An under-privileged key returns `200 {"members":[]}`, NOT a 403. Empty
 *     means "wrong key" far more often than "nobody reported", so an empty
 *     member list is treated as an error.
 *   - A stray cookie reroutes the hostname to a demo database with plausible
 *     fiction. Same host, same TLS, no warning. So: no cookies, ever.
 *   - `hrmsStatus` is resolved live from OwnHRMS. When that is unreachable it
 *     returns null, which means UNKNOWN. Reading it as "not an employee"
 *     would retire the whole company during one upstream outage.
 *
 * Read-only is enforced here, not by the credential: the estate audit found
 * API-key scopes are stored but never checked on these routes. There is no
 * code path below that issues anything but a GET.
 */

const BASE = (process.env.CHIEFOS_OWNTASKS_URL ?? 'https://tasks.panscience.ai').replace(/\/$/, '');
const KEY = process.env.CHIEFOS_OWNTASKS_KEY ?? '';

interface RawUpdate {
  id?: string;
  date?: string;
  submittedAt?: string | null;
  updatedAt?: string;
  createdAt?: string;
  isDraft?: boolean;
  completedTasks?: string;
  pendingTasks?: string;
  biggestWin?: string;
  plansForTomorrow?: string;
  blockers?: string;
}

interface RawMember {
  userId?: string;
  user?: {
    id?: string;
    name?: string;
    email?: string;
    isActive?: boolean;
    hrmsStatus?: string | null;
  };
  workspaceUpdates?: Array<{ update?: RawUpdate | null }>;
}

/**
 * Rich text to plain text.
 *
 * The fields are HTML. Tags left in would poison keyword matching and render
 * as markup beside the extraction, so they go - but no words change.
 */
export function stripHtml(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * The person's own words, reassembled.
 *
 * All five fields are kept, labelled with the questions that produced them.
 * Dropping four to make a tidy string would break the one promise the product
 * makes everywhere: the original is shown beside what was read from it.
 */
export function assembleOriginal(fields: DailyUpdateForm): string {
  const sections: Array<[string, string | null | undefined]> = [
    ['What specific tasks did you complete today?', fields.tasksCompleted],
    ['Biggest win for the day', fields.biggestWin],
    ['Pending tasks from today', fields.pendingTasks],
    ['Plans for tomorrow', fields.plansForTomorrow],
    ['Blockers or challenges', fields.blockers],
  ];

  return sections
    .filter(([, value]) => value && value.trim().length > 0)
    .map(([label, value]) => `${label}\n${value!.trim()}`)
    .join('\n\n');
}

function toFields(raw: RawUpdate): DailyUpdateForm {
  return {
    tasksCompleted: stripHtml(raw.completedTasks),
    biggestWin: stripHtml(raw.biggestWin),
    pendingTasks: stripHtml(raw.pendingTasks),
    plansForTomorrow: stripHtml(raw.plansForTomorrow),
    // "" means nothing was reported; null would mean nothing was asked. The
    // source always sends a string, and form.ts treats the two differently.
    blockers: stripHtml(raw.blockers),
  };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
    // No cookies. A stray own360_demo cookie silently serves a demo database
    // of plausible fiction over the same host and TLS.
    credentials: 'omit',
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`OwnTasks returned ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export const ownTasksSource: UpdateSource = {
  id: 'owntasks',
  label: 'OwnTasks',
  configured: Boolean(BASE && KEY),

  async healthCheck(): Promise<HealthResult> {
    if (!this.configured) {
      return { ok: false, message: 'Set CHIEFOS_OWNTASKS_URL and CHIEFOS_OWNTASKS_KEY.' };
    }

    try {
      const me = await get<{ email?: string; scopes?: string }>('/api/connector/v1/me');

      // The real test. /me passes for any valid key; only all-workspaces
      // proves the key belongs to an OWNER of a shared workspace, and it
      // proves it by returning people rather than by returning an error.
      const today = new Date().toISOString().slice(0, 10);
      const probe = await get<{ members?: RawMember[] }>(
        `/api/updates/all-workspaces?date=${today}`,
      );

      if (!probe.members || probe.members.length === 0) {
        return {
          ok: false,
          message:
            'The key authenticated but all-workspaces returned nobody. That means the key does ' +
            'not belong to an OWNER of a workspace with isShared = true - it does NOT mean ' +
            'nobody reported today. Refusing to import.',
        };
      }

      return {
        ok: true,
        message: `OwnTasks reachable as ${me.email ?? 'unknown'}; ${probe.members.length} people visible.`,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },

  async fetchDay(date: string): Promise<DayResult> {
    const body = await get<{ members?: RawMember[] }>(`/api/updates/all-workspaces?date=${date}`);
    const members = body.members ?? [];

    if (members.length === 0) {
      // Never silently treat this as a quiet day - see healthCheck.
      throw new Error(
        `all-workspaces returned no members for ${date}. Treating as a credential problem, not an empty day.`,
      );
    }

    const people: ExternalPerson[] = members.map((member) => {
      const externalId = member.user?.id ?? member.userId ?? '';
      const raw = member.workspaceUpdates?.[0]?.update ?? null;

      const fields = raw ? toFields(raw) : null;
      const updatedAt = raw?.updatedAt ?? raw?.submittedAt ?? raw?.createdAt ?? `${date}T00:00:00.000Z`;

      return {
        externalId,
        name: member.user?.name ?? 'Unknown',
        email: member.user?.email ?? null,
        // hrmsStatus null means OwnHRMS could not be reached. Unknown, not absent.
        isActive:
          member.user?.hrmsStatus == null ? (member.user?.isActive ?? null) : member.user.hrmsStatus === 'Active',
        update:
          raw && fields
            ? {
                externalId: raw.id ?? `${externalId}:${date}`,
                date: raw.date ?? date,
                submittedAt: raw.submittedAt ?? null,
                updatedAt,
                isDraft: Boolean(raw.isDraft),
                fields,
                originalText: assembleOriginal(fields),
              }
            : null,
      };
    });

    return { date, people };
  },
};
