import type { Extraction } from '@/lib/ai/types';

/**
 * Turns a confirmed extraction into a blocker: its priority, the sentence
 * explaining that priority, and a first draft of the response.
 *
 * Two rules drive the whole file:
 *
 *  1. A priority with no stated reason is useless in front of an executive.
 *     "Why is that first?" has to be answered on screen, not improvised, so
 *     priority and priority_reason are produced together and the reason is
 *     assembled from the facts that actually moved the score.
 *
 *  2. The draft is a DRAFT. It is composed from a template here, it is clearly
 *     labelled as a draft in the UI, it is fully editable, and nothing is sent
 *     until a human presses approve. When an approved model is connected it can
 *     write a better draft - but it still will not send it.
 */

export interface EscalationInput {
  extraction: Extraction;
  projectName: string;
  /** Tasks on the project that are currently blocked, for the reason text. */
  blockedTaskCount: number;
  /** Days until the project target date, or null when there is none. */
  daysToTarget: number | null;
  /** True when the dependency sits outside the raiser's own department. */
  crossTeam: boolean;
  raisedByName: string;
}

export interface Escalation {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  priorityReason: string;
}

/** Trims a captured clause into something that reads as a title. */
function asTitle(text: string, fallback: string): string {
  const cleaned = text.trim().replace(/\s+/g, ' ').replace(/[.;,]$/, '');
  if (!cleaned) return fallback;
  const titled = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return titled.length > 90 ? `${titled.slice(0, 87)}...` : titled;
}

export function buildEscalation(input: EscalationInput): Escalation {
  const { extraction, projectName, blockedTaskCount, daysToTarget, crossTeam } = input;

  const subject = extraction.blocker ?? extraction.help_needed ?? extraction.risk ?? 'Blocked work';
  const dependency = extraction.dependency_department;

  const title = asTitle(subject, `${projectName} is blocked`);

  const description = [
    extraction.blocker ? `Blocker: ${extraction.blocker}.` : null,
    extraction.help_needed ? `Needs: ${extraction.help_needed}.` : null,
    dependency ? `Dependency: ${dependency}.` : null,
    extraction.deadline_text ? `Stated timing: "${extraction.deadline_text}".` : null,
    extraction.risk ? `Risk: ${extraction.risk}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  // ---- Priority, with the reasons recorded as they are applied ----------
  const reasons: string[] = [];
  let score = 0;

  if (daysToTarget !== null && daysToTarget <= 3) {
    score += 2;
    reasons.push(
      daysToTarget <= 0
        ? 'the project target date has already passed'
        : `the project is due in ${daysToTarget} day${daysToTarget === 1 ? '' : 's'}`,
    );
  } else if (daysToTarget !== null && daysToTarget <= 7) {
    score += 1;
    reasons.push(`the project is due in ${daysToTarget} days`);
  }

  if (blockedTaskCount >= 2) {
    score += 2;
    reasons.push(`it is blocking ${blockedTaskCount} downstream tasks`);
  } else if (blockedTaskCount === 1) {
    score += 1;
    reasons.push('it is blocking one downstream task');
  }

  if (crossTeam && dependency) {
    score += 1;
    reasons.push(`the dependency sits outside the owning team (${dependency})`);
  }

  if (extraction.deadline_text) {
    score += 1;
    reasons.push(`the person raising it stated a deadline of "${extraction.deadline_text}"`);
  }

  if (!dependency) {
    // Unowned work is where things rot, so it raises priority rather than
    // lowering it - but the reason has to say that plainly.
    score += 1;
    reasons.push('no owning team has been identified yet');
  }

  const priority: Escalation['priority'] = score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';

  const reasonSentence = reasons.length
    ? `Prioritised ${priority} because ${joinReasons(reasons)}.`
    : `Prioritised ${priority}: raised as a blocker with no deadline, no stated dependency and nothing waiting behind it.`;

  return { title, description: description || title, priority, priorityReason: reasonSentence };
}

function joinReasons(reasons: string[]): string {
  if (reasons.length === 1) return reasons[0];
  return `${reasons.slice(0, -1).join(', ')} and ${reasons[reasons.length - 1]}`;
}

/**
 * Composes the draft response the CEO sees pre-filled in the inbox.
 *
 * Deterministic and template-based. It is honest about what it is: the UI
 * labels it a draft assembled from the update, not advice from a model.
 */
export function draftResponse(input: {
  extraction: Extraction;
  raisedByName: string;
  projectName: string;
  dependencyDepartment: string | null;
  dependencyContactName: string | null;
}): string {
  const { extraction, raisedByName, projectName, dependencyDepartment, dependencyContactName } = input;

  const firstName = raisedByName.split(' ')[0];
  const owner = dependencyContactName ?? (dependencyDepartment ? `the ${dependencyDepartment} lead` : null);
  const ask = extraction.help_needed ?? extraction.blocker ?? 'what is needed to unblock this';

  // Only add a timing clause when the ask does not already carry one -
  // otherwise the draft reads "a decision today ... by today".
  const deadline = extraction.deadline_text;
  const askMentionsTiming = deadline ? ask.toLowerCase().includes(deadline.toLowerCase()) : false;
  const timing = askMentionsTiming ? '' : deadline ? ` by ${deadline}` : ' today';

  const lines: string[] = [];

  if (owner) {
    lines.push(`${owner} to confirm ${lowerFirst(ask)}${timing}.`);
  } else {
    lines.push(`We need an owner for this. Proposing it sits with the project lead until someone else claims it.`);
  }

  lines.push(
    `${firstName}, proceed on the rest of ${projectName} in the meantime and flag here if this is still ` +
      `blocked after that point.`,
  );

  if (extraction.risk) {
    lines.push(`If the risk you raised (${lowerFirst(extraction.risk)}) materialises, escalate to me directly.`);
  }

  return lines.join(' ');
}

function lowerFirst(text: string): string {
  const trimmed = text.trim().replace(/[.;,]$/, '');
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** The question the CEO sends back when the update is not actionable. */
export function clarificationRequest(input: { extraction: Extraction; projectName: string }): string {
  const { extraction, projectName } = input;
  if (extraction.clarification_question) return extraction.clarification_question;
  if (!extraction.dependency_department) {
    return `Which team or person are you waiting on for ${projectName}?`;
  }
  return `What specifically do you need to get ${projectName} moving again?`;
}
