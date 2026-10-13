import type { Extraction, ExtractionContext } from '@/lib/ai/types';
import { extractWithRules } from '@/lib/ai/rules';

/**
 * Mapping the daily-update form into our extraction shape.
 *
 * The form already asks the right questions, each in its own field, so almost
 * nothing has to be inferred here. That is a large quality win over reading a
 * paragraph of prose: the blocker field IS the blocker, and when someone
 * writes "no" in it, that is a real answer rather than an absent one.
 *
 * The rules engine is still used, but only on the fields where free text
 * genuinely needs reading - never to second-guess an explicit answer.
 */

export interface DailyUpdateForm {
  /** "What specific tasks did you complete today?" */
  tasksCompleted: string;
  /** "Biggest Win for the day" */
  biggestWin?: string | null;
  /** "Do you have any pending tasks from today?" - "no" is a real answer. */
  pendingTasks?: string | null;
  /** "Plans for tomorrow" */
  plansForTomorrow?: string | null;
  /** "Did you face any blocker or challenges?" - "no" is a real answer. */
  blockers?: string | null;
}

/**
 * True when a field is the person explicitly saying "nothing here".
 *
 * This distinction carries real weight: an empty field means they did not
 * answer and we should ask; "no" means they answered and we must not.
 */
export function isExplicitNo(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const text = value.trim().toLowerCase().replace(/[.!]$/, '');
  return ['no', 'none', 'nil', 'na', 'n/a', 'nothing', 'no blockers', 'no blocker'].includes(text);
}

function isAnswered(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function extractFromForm(form: DailyUpdateForm, ctx: ExtractionContext): Extraction {
  // The tasks field is prose, so read progress and project from it as usual.
  const base = extractWithRules(form.tasksCompleted ?? '', ctx);

  const blockerAnswered = isAnswered(form.blockers);
  const blockerIsNo = isExplicitNo(form.blockers);
  const hasBlocker = blockerAnswered && !blockerIsNo;

  // Explicit answers win over anything read from the prose. Someone who wrote
  // "no" under blockers has not been "detected as blocked" by a keyword in
  // their task list, and treating them that way would be the exact kind of
  // confident wrongness this product exists to avoid.
  const blocker = hasBlocker ? form.blockers!.trim() : null;

  let status: Extraction['status'] = base.status;
  if (hasBlocker) status = 'blocked';
  else if (blockerIsNo && base.status === 'blocked') status = base.progress_percent === 100 ? 'done' : 'on_track';

  const pendingAnswered = isAnswered(form.pendingTasks);
  const pendingIsNo = isExplicitNo(form.pendingTasks);
  const risk = pendingAnswered && !pendingIsNo ? form.pendingTasks!.trim() : base.risk;

  // Dependency and help are only read from the blocker field, not the whole
  // form, so a mention of Finance in a completed task cannot become a blocker.
  const fromBlocker = hasBlocker ? extractWithRules(blocker!, ctx) : null;

  const extraction: Extraction = {
    ...base,
    status,
    blocker,
    risk,
    dependency_department: fromBlocker?.dependency_department ?? null,
    help_needed: fromBlocker?.help_needed ?? null,
    deadline_text: fromBlocker?.deadline_text ?? base.deadline_text,
    needs_clarification: false,
    clarification_question: null,
  };

  // Ask only about what the form left genuinely unanswered.
  if (hasBlocker && !extraction.dependency_department) {
    extraction.needs_clarification = true;
    extraction.clarification_question =
      'You reported a blocker - which team or person are you waiting on?';
  } else if (!blockerAnswered) {
    extraction.needs_clarification = true;
    extraction.clarification_question = 'Did you face any blockers today?';
  }

  return extraction;
}

/**
 * The plans-for-tomorrow field is already a list of intended work, which is
 * exactly what the scheduler takes as input. Returned separately so a CEO can
 * see what their team intends to do tomorrow beside their own day.
 */
export function plansForScheduling(form: DailyUpdateForm): string | null {
  return isAnswered(form.plansForTomorrow) && !isExplicitNo(form.plansForTomorrow)
    ? form.plansForTomorrow.trim()
    : null;
}
