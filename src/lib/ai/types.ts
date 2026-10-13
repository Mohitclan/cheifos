import { z } from 'zod';

/**
 * The contract between the extractor, the API, the UI, and - later - a real
 * language model. One schema, four consumers.
 *
 * Rule that matters more than any other here: EVERY FIELD IS NULLABLE.
 * Absence is a legitimate, representable outcome. A missing value must never
 * be filled with a default, an inference, or a guess.
 */
export const extractionSchema = z.object({
  project: z.string().nullable(),
  task: z.string().nullable(),
  progress_percent: z.number().int().min(0).max(100).nullable(),
  status: z.enum(['on_track', 'at_risk', 'blocked', 'done']).nullable(),
  blocker: z.string().nullable(),
  dependency_department: z.string().nullable(),
  help_needed: z.string().nullable(),

  /**
   * Captured VERBATIM as the user wrote it - "today", "by Friday", "EOD".
   * Never converted to a date here. A candidate datetime may be proposed
   * separately and shown as an editable assumption, but this field holds words.
   */
  deadline_text: z.string().nullable(),

  risk: z.string().nullable(),

  /** True when the extractor knows something is missing and must ask. */
  needs_clarification: z.boolean(),
  clarification_question: z.string().nullable(),

  /**
   * Fields the extractor inferred rather than read literally (e.g. "halfway"
   * -> 50). The UI marks these so the user can see what was assumed.
   */
  inferred_fields: z.array(z.string()),
});

export type Extraction = z.infer<typeof extractionSchema>;

/** An extraction with nothing found. The safe fallback for any failure path. */
export function emptyExtraction(): Extraction {
  return {
    project: null,
    task: null,
    progress_percent: null,
    status: null,
    blocker: null,
    dependency_department: null,
    help_needed: null,
    deadline_text: null,
    risk: null,
    needs_clarification: true,
    clarification_question:
      'I could not read anything specific from that. Could you say what you worked on and whether anything is blocking you?',
    inferred_fields: [],
  };
}

export interface ExtractionContext {
  /** Department names seeded in this workspace, for dependency matching. */
  departments: string[];
  /** Projects visible to the submitting employee, for fuzzy project matching. */
  projects: string[];
  /** Tasks on the selected project. */
  tasks: string[];
}

/**
 * The swappable seam.
 *
 * `rules` implements this with deterministic TypeScript and always works.
 * `llm` implements it with a model and is currently a stub - see llm.ts.
 * Pages and API routes depend on this interface and nothing else, so adding a
 * model is a one-file change plus an env var.
 */
export interface AiProvider {
  readonly id: 'rules' | 'llm';
  /** Shown in the provider status chip in the top bar. */
  readonly label: string;
  extractUpdate(text: string, ctx: ExtractionContext): Promise<Extraction>;
}
