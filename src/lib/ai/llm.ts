import type { AiProvider, Extraction, ExtractionContext } from './types';
import { extractionSchema } from './types';
import { extractWithRules } from './rules';

/**
 * ============================================================================
 *  THIS FILE IS THE ONLY FILE YOU NEED TO WRITE TO ADD A MODEL.
 * ============================================================================
 *
 * Nothing else in the codebase imports a model, knows a provider name, or
 * cares how extraction happens. Pages and API routes depend on the AiProvider
 * interface in ./types and nothing more.
 *
 * TO ENABLE:
 *   1. Implement callModel() below.
 *   2. Set CHIEFOS_AI_PROVIDER=llm in .env.local
 *   3. Restart. The provider chip in the top bar will update by itself.
 *
 * CONTRACT - these are not style preferences, they are what the demo promises
 * on screen, and breaking one makes the product dishonest:
 *
 *   - Return ONLY fields actually supported by the user's text.
 *     A field you cannot find is null. Never a default, never a guess.
 *
 *   - deadline_text holds the user's WORDS ("today", "by Friday"), never a
 *     resolved date. Date resolution happens later, in the UI, as a labelled
 *     and editable assumption.
 *
 *   - If a required piece is missing, set needs_clarification and write a
 *     specific clarification_question. Asking beats inventing.
 *
 *   - Put anything you inferred rather than read (e.g. "halfway" -> 50) into
 *     inferred_fields so the UI can mark it.
 *
 *   - Validate with extractionSchema before returning. Malformed output must
 *     fall back, not throw - see the catch block below.
 *
 *   - The model NEVER issues SQL and NEVER writes to the database. It returns
 *     this object and nothing else. Application code performs every write.
 *
 * SUGGESTED APPROACH:
 *   zod-to-json-schema over extractionSchema gives you a JSON Schema for
 *   structured output / tool-calling, so the model's contract stays generated
 *   from the same source of truth the UI validates against.
 */

const MODEL_ENDPOINT = process.env.CHIEFOS_LLM_ENDPOINT ?? '';
const MODEL_NAME = process.env.CHIEFOS_LLM_MODEL ?? '';

function buildPrompt(text: string, ctx: ExtractionContext): string {
  return [
    'Extract structured fields from this employee status update.',
    'Return JSON only. Use null for anything the text does not state.',
    'Do not infer deadlines, owners, or progress that are not present.',
    '',
    `Known departments: ${ctx.departments.join(', ')}`,
    `Known projects: ${ctx.projects.join(', ')}`,
    `Known tasks: ${ctx.tasks.join(', ')}`,
    '',
    `Update: """${text}"""`,
  ].join('\n');
}

async function callModel(_prompt: string): Promise<unknown> {
  // ---------------------------------------------------------------------
  // IMPLEMENT ME.
  //
  // Expected shape of the return value: an object matching extractionSchema
  // (see ./types.ts). Parse the model's JSON here and return the object.
  //
  // Example skeleton for an OpenAI-compatible endpoint:
  //
  //   const res = await fetch(`${MODEL_ENDPOINT}/v1/chat/completions`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({
  //       model: MODEL_NAME,
  //       messages: [{ role: 'user', content: _prompt }],
  //       response_format: { type: 'json_object' },
  //       temperature: 0,
  //     }),
  //   });
  //   const data = await res.json();
  //   return JSON.parse(data.choices[0].message.content);
  // ---------------------------------------------------------------------
  throw new Error('LLM provider not implemented');
}

export const llmProvider: AiProvider = {
  id: 'llm',
  label: MODEL_NAME ? `Model (${MODEL_NAME})` : 'Model',

  async extractUpdate(text: string, ctx: ExtractionContext): Promise<Extraction> {
    try {
      const raw = await callModel(buildPrompt(text, ctx));
      const parsed = extractionSchema.safeParse(raw);

      if (!parsed.success) {
        // Malformed model output is expected occasionally and must never reach
        // the UI. Fall back to rules rather than showing the user an error.
        console.warn('[ai] model output failed schema validation, using rules', parsed.error.issues);
        return extractWithRules(text, ctx);
      }
      return parsed.data;
    } catch (err) {
      console.warn('[ai] model call failed, using rules:', (err as Error).message);
      return extractWithRules(text, ctx);
    }
  },
};

export const llmConfigured = Boolean(MODEL_ENDPOINT && MODEL_NAME);
