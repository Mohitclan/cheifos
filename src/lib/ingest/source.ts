import type { DayResult, HealthResult, UpdateSource } from './types';
import { ownTasksSource } from './owntasks';

/**
 * Picks the update source. Mirrors lib/ai/provider.ts deliberately.
 *
 * CHIEFOS_UPDATE_SOURCE=owntasks -> read from OwnTasks (see owntasks.ts)
 * anything else / unset          -> nothing is imported
 */

/** The default. Imports nothing, and is honest that it is doing so. */
const noneSource: UpdateSource = {
  id: 'none',
  label: 'No source connected',
  configured: true,
  async healthCheck(): Promise<HealthResult> {
    return { ok: false, message: 'No update source configured.' };
  },
  async fetchDay(date: string): Promise<DayResult> {
    return { date, people: [] };
  },
};

export function getUpdateSource(): UpdateSource {
  if (process.env.CHIEFOS_UPDATE_SOURCE === 'owntasks' && ownTasksSource.configured) {
    return ownTasksSource;
  }
  return noneSource;
}

/** For the provider chip, beside the extraction provider. */
export function updateSourceStatus(): { label: string; external: boolean } {
  const source = getUpdateSource();
  return { label: source.label, external: source.id !== 'none' };
}
