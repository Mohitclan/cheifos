import type { ExternalUpdate, UpdateSource } from './types';
import { httpSource } from './http';

/**
 * Picks the update source. Mirrors lib/ai/provider.ts deliberately - same
 * shape, same honesty about what is actually switched on.
 *
 * CHIEFOS_UPDATE_SOURCE=http -> read from the external API (see http.ts)
 * anything else / unset      -> nothing is imported; people write here
 */

/** The default. Imports nothing, which is the correct behaviour when no
 *  source is configured - an empty result is not an error. */
const noneSource: UpdateSource = {
  id: 'none',
  label: 'Written in ChiefOS',
  configured: true,
  async fetchSince(): Promise<ExternalUpdate[]> {
    return [];
  },
};

export function getUpdateSource(): UpdateSource {
  if (process.env.CHIEFOS_UPDATE_SOURCE === 'http' && httpSource.configured) {
    return httpSource;
  }
  return noneSource;
}

/** For the provider chip, beside the extraction provider. */
export function updateSourceStatus(): { label: string; external: boolean } {
  const source = getUpdateSource();
  return { label: source.label, external: source.id !== 'none' };
}
