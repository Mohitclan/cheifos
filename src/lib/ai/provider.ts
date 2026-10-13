import type { AiProvider } from './types';
import { rulesProvider } from './rules';
import { llmProvider, llmConfigured } from './llm';

/**
 * Chooses the extraction provider. This is the whole switch.
 *
 * CHIEFOS_AI_PROVIDER=llm  -> use the model (see llm.ts)
 * anything else / unset    -> deterministic rules, which always work
 *
 * The rules path is not a degraded mode. It is the demo default, and the
 * system is honest about which one is running via providerStatus() below.
 */
export function getProvider(): AiProvider {
  if (process.env.CHIEFOS_AI_PROVIDER === 'llm' && llmConfigured) {
    return llmProvider;
  }
  return rulesProvider;
}

/** Drives the provider chip in the top bar. Always tells the truth. */
export function providerStatus(): {
  extraction: string;
  llm: string;
  llmConnected: boolean;
} {
  const provider = getProvider();
  return {
    extraction: provider.label,
    llm: llmConfigured ? 'connected' : 'not connected',
    llmConnected: llmConfigured && provider.id === 'llm',
  };
}

export type { AiProvider, Extraction, ExtractionContext } from './types';
export { extractionSchema, emptyExtraction } from './types';
