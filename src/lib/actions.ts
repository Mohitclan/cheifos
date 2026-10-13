'use server';

import { revalidatePath } from 'next/cache';
import { audit, nowIso, run, tx } from '@/lib/db';
import {
  getBlocker,
  getDepartmentContact,
  getDepartmentIdByName,
  getDepartmentNames,
  getMessage,
  getProject,
  getProjectsForEmployee,
  getTasksForProject,
  getUser,
} from '@/lib/db/queries';
import { getProvider } from '@/lib/ai/provider';
import { extractionSchema, emptyExtraction, type Extraction } from '@/lib/ai/types';
import { buildEscalation, clarificationRequest, draftResponse } from '@/lib/escalation';
import { planDay, type Proposal } from '@/lib/schedule/plan';
import { authorize } from '@/lib/auth/guard';
import { buildBriefing, type Briefing } from '@/lib/chief/briefing';
import { answerQuestion, type Answer } from '@/lib/chief/ask';
import { seedDemoWorkspace } from '@/lib/demo/seed';

/**
 * Every write in the application.
 *
 * Rules this file exists to enforce:
 *   - The audit row is written inside the same transaction as the state
 *     change. An audit trail with gaps is worse than none, because it looks
 *     complete.
 *   - The extraction model never writes and never issues SQL. It returns
 *     fields; the code below validates them and performs the write.
 *   - What the user confirmed in the preview is what persists, not what the
 *     extractor originally proposed.
 *   - Nothing is sent or closed without an explicit human action.
 */

const ALL_PATHS = ['/', '/chief', '/decisions', '/employee', '/schedule', '/activity'];

function revalidateAll(): void {
  for (const path of ALL_PATHS) revalidatePath(path);
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(form: FormData, key: string): string | null {
  const value = text(form, key);
  return value.length ? value : null;
}

function int(form: FormData, key: string): number | null {
  const raw = text(form, key);
  // An empty field is absent, not zero. Without this guard an unselected
  // task arrives as 0 and fails the foreign key on insert.
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

// --------------------------------------------------------------------------
// Demo identity (NOT authentication - see src/lib/demo/session.ts)
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Extraction preview
// --------------------------------------------------------------------------

export interface PreviewResult {
  extraction: Extraction;
  /** Which provider produced this, for the label above the preview. */
  providerLabel: string;
  /** A candidate datetime for deadline_text, shown as an editable assumption. */
  deadlineAssumption: string | null;
}

/**
 * Runs extraction for the preview. Read-only: nothing is written until the
 * employee submits the fields they have reviewed.
 */
export async function previewExtraction(input: {
  text: string;
  employeeId: number;
  projectId: number | null;
}): Promise<PreviewResult> {
  const auth = await authorize();
  if (!auth.ok) throw new Error(auth.message);
  const provider = getProvider();
  const projects = getProjectsForEmployee(input.employeeId);
  const tasks = input.projectId ? getTasksForProject(input.projectId) : [];

  let extraction: Extraction;
  try {
    extraction = await provider.extractUpdate(input.text, {
      departments: getDepartmentNames(),
      projects: projects.map((p) => p.name),
      tasks: tasks.map((t) => t.title),
    });
    // Validate the provider output before it reaches the UI. A malformed
    // extraction must fail safe to "nothing found", never to a stack trace.
    const parsed = extractionSchema.safeParse(extraction);
    extraction = parsed.success ? parsed.data : emptyExtraction();
  } catch {
    extraction = emptyExtraction();
  }

  return {
    extraction,
    providerLabel: provider.label,
    deadlineAssumption: null,
  };
}

// --------------------------------------------------------------------------
// Employee submits an update
// --------------------------------------------------------------------------

export interface SubmitResult {
  ok: boolean;
  updateId?: number;
  blockerId?: number;
  message: string;
  error?: string;
}

/**
 * Persists an update exactly as the employee confirmed it, and - when they
 * confirmed a blocked status - raises a blocker with an explainable priority
 * and a draft response for the CEO.
 */
export async function submitUpdate(form: FormData): Promise<SubmitResult> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, message: auth.message };
  const employeeId = int(form, 'employeeId');
  const projectId = int(form, 'projectId');
  const originalText = text(form, 'originalText');

  if (employeeId === null || projectId === null) {
    return { ok: false, message: 'Select who you are and which project this is about.' };
  }
  if (originalText.length < 3) {
    return { ok: false, message: 'Write your update before submitting.' };
  }

  const employee = getUser(employeeId);
  const project = getProject(projectId);
  if (!employee || !project) {
    return { ok: false, message: 'That person or project no longer exists. Reload and try again.' };
  }

  // The confirmed fields from the preview form. These are what persist.
  const candidate = {
    project: optionalText(form, 'field_project') ?? project.name,
    task: optionalText(form, 'field_task'),
    progress_percent: optionalText(form, 'field_progress') === null ? null : int(form, 'field_progress'),
    status: (optionalText(form, 'field_status') as Extraction['status']) ?? null,
    blocker: optionalText(form, 'field_blocker'),
    dependency_department: optionalText(form, 'field_dependency'),
    help_needed: optionalText(form, 'field_help'),
    deadline_text: optionalText(form, 'field_deadline'),
    risk: optionalText(form, 'field_risk'),
    needs_clarification: text(form, 'field_needs_clarification') === 'true',
    clarification_question: optionalText(form, 'field_clarification_question'),
    inferred_fields: (optionalText(form, 'field_inferred') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };

  const parsed = extractionSchema.safeParse(candidate);
  if (!parsed.success) {
    // Fail safe: keep the raw text, drop the unparseable fields, tell the
    // user which one to fix. Never discard what they wrote.
    return {
      ok: false,
      message: 'One of the fields could not be saved as written. Check the highlighted values.',
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }

  const extraction = parsed.data;
  const taskId = int(form, 'taskId');
  const source = text(form, 'source') === 'voice' ? 'voice' : text(form, 'source') === 'sample' ? 'sample' : 'typed';

  try {
    return tx(() => {
      const updateId = run(
        `INSERT INTO updates (employee_id, project_id, task_id, original_text, transcript,
                              extracted_json, source, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
        [
          employeeId,
          projectId,
          taskId,
          originalText,
          source === 'voice' ? originalText : null,
          JSON.stringify(extraction),
          source,
          nowIso(),
        ],
      );

      audit({
        actorId: employeeId,
        action: 'update.submitted',
        entityType: 'update',
        entityId: updateId,
        summary: `${employee.name} submitted an update on ${project.name}`,
        metadata: { confirmedFields: extraction },
      });

      // Project progress follows what the employee confirmed, never an
      // inference made on their behalf.
      if (extraction.progress_percent !== null) {
        run('UPDATE projects SET progress = ? WHERE id = ?', [extraction.progress_percent, projectId]);
        audit({
          actorId: employeeId,
          action: 'project.progress_updated',
          entityType: 'project',
          entityId: projectId,
          summary: `${project.name} progress set to ${extraction.progress_percent}% from the submitted update`,
        });
      }

      if (extraction.status && extraction.status !== 'done') {
        run('UPDATE projects SET status = ? WHERE id = ?', [extraction.status, projectId]);
      }

      if (extraction.status !== 'blocked') {
        return {
          ok: true,
          updateId,
          message: 'Update submitted. Nothing was escalated, because nothing was flagged as blocked.',
        };
      }

      // ---- Blocked: raise a blocker with a stated reason ----------------
      const departmentId = extraction.dependency_department
        ? (getDepartmentIdByName(extraction.dependency_department) ?? null)
        : null;
      const contact = departmentId ? getDepartmentContact(departmentId) : undefined;

      const blockedTasks = getTasksForProject(projectId).filter((t) => t.status === 'blocked').length;
      const daysToTarget = project.target_date
        ? Math.ceil((new Date(project.target_date).getTime() - Date.now()) / 86_400_000)
        : null;

      const escalation = buildEscalation({
        extraction,
        projectName: project.name,
        blockedTaskCount: blockedTasks,
        daysToTarget,
        crossTeam: Boolean(extraction.dependency_department && extraction.dependency_department !== employee.department),
        raisedByName: employee.name,
      });

      const blockerId = run(
        `INSERT INTO blockers (update_id, project_id, title, description, raised_by_id, owner_id,
                               dependency_department_id, priority, priority_reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_decision', ?)`,
        [
          updateId,
          projectId,
          escalation.title,
          escalation.description,
          employeeId,
          contact?.id ?? null,
          departmentId,
          escalation.priority,
          escalation.priorityReason,
          nowIso(),
        ],
      );

      audit({
        actorId: employeeId,
        action: 'blocker.created',
        entityType: 'blocker',
        entityId: blockerId,
        summary: `Blocker raised from the update: ${escalation.title}`,
        metadata: { priority: escalation.priority, reason: escalation.priorityReason },
      });

      // A draft response, so the blocker reaches the CEO with something to
      // edit rather than a blank box. It cannot be sent without approval.
      const decisionId = run(
        `INSERT INTO decisions (blocker_id, created_by, proposed_response, approved_response, status, created_at)
         VALUES (?, ?, ?, NULL, 'draft', ?)`,
        [
          blockerId,
          employeeId,
          draftResponse({
            extraction,
            raisedByName: employee.name,
            projectName: project.name,
            dependencyDepartment: extraction.dependency_department,
            dependencyContactName: contact?.name ?? null,
          }),
          nowIso(),
        ],
      );

      audit({
        actorId: null,
        action: 'decision.drafted',
        entityType: 'decision',
        entityId: decisionId,
        summary: 'Draft response prepared for review (not sent)',
      });

      run('UPDATE projects SET status = ? WHERE id = ?', ['blocked', projectId]);

      return {
        ok: true,
        updateId,
        blockerId,
        message: 'Update submitted and the blocker is now in the decision inbox, waiting on a human.',
      };
    });
  } catch (err) {
    return {
      ok: false,
      message: 'The update could not be saved. Nothing was written.',
      error: (err as Error).message,
    };
  } finally {
    revalidateAll();
  }
}

// --------------------------------------------------------------------------
// CEO approves a response
// --------------------------------------------------------------------------

export async function approveDecision(form: FormData): Promise<SubmitResult> {
  const auth = await authorize('ceo');
  if (!auth.ok) return { ok: false, message: auth.message };
  const blockerId = int(form, 'blockerId');
  const ceoId = int(form, 'ceoId');
  const response = text(form, 'response');

  if (blockerId === null || ceoId === null) {
    return { ok: false, message: 'Missing blocker or approver.' };
  }
  if (response.length < 5) {
    return { ok: false, message: 'Write the guidance you want to send before approving.' };
  }

  const blocker = getBlocker(blockerId);
  if (!blocker) return { ok: false, message: 'That blocker no longer exists.' };
  if (blocker.raised_by_id === null) {
    return { ok: false, message: 'This blocker has no author to send guidance to.' };
  }

  try {
    return tx(() => {
      const approvedAt = nowIso();
      let decisionId = blocker.decision_id;

      if (decisionId) {
        run(
          `UPDATE decisions SET approved_response = ?, status = 'sent', approved_at = ? WHERE id = ?`,
          [response, approvedAt, decisionId],
        );
      } else {
        decisionId = run(
          `INSERT INTO decisions (blocker_id, created_by, proposed_response, approved_response, status, created_at, approved_at)
           VALUES (?, ?, ?, ?, 'sent', ?, ?)`,
          [blockerId, ceoId, response, response, approvedAt, approvedAt],
        );
      }

      audit({
        actorId: ceoId,
        action: 'decision.approved',
        entityType: 'decision',
        entityId: decisionId,
        summary: 'Response approved by a human and released for sending',
        metadata: { blockerId },
      });

      const messageId = run(
        `INSERT INTO messages (sender_id, recipient_id, decision_id, body, sent_at)
         VALUES (?, ?, ?, ?, ?)`,
        [ceoId, blocker.raised_by_id, decisionId, response, approvedAt],
      );

      audit({
        actorId: ceoId,
        action: 'message.sent',
        entityType: 'message',
        entityId: messageId,
        summary: `Guidance sent to ${blocker.raised_by_name ?? 'the author'} on "${blocker.title}"`,
      });

      // The blocker moves to decision_sent, NOT resolved. Only an explicit
      // resolve action closes a blocker.
      run(`UPDATE blockers SET status = 'decision_sent' WHERE id = ?`, [blockerId]);
      audit({
        actorId: ceoId,
        action: 'blocker.status_changed',
        entityType: 'blocker',
        entityId: blockerId,
        summary: 'Blocker moved to decision sent (still open until explicitly resolved)',
      });

      return { ok: true, message: 'Approved and sent. The blocker stays open until someone resolves it.' };
    });
  } catch (err) {
    return { ok: false, message: 'Nothing was sent - the write failed.', error: (err as Error).message };
  } finally {
    revalidateAll();
  }
}

/** Sends a question back instead of a decision. The blocker does not move on. */
export async function requestClarification(form: FormData): Promise<SubmitResult> {
  const auth = await authorize('ceo');
  if (!auth.ok) return { ok: false, message: auth.message };
  const blockerId = int(form, 'blockerId');
  const ceoId = int(form, 'ceoId');
  const blocker = blockerId === null ? undefined : getBlocker(blockerId);

  if (!blocker || ceoId === null || blocker.raised_by_id === null) {
    return { ok: false, message: 'Missing blocker or approver.' };
  }

  const extraction: Extraction = blocker.extracted_json
    ? (JSON.parse(blocker.extracted_json) as Extraction)
    : emptyExtraction();

  const question =
    optionalText(form, 'question') ??
    clarificationRequest({ extraction, projectName: blocker.project_name });

  try {
    return tx(() => {
      const sentAt = nowIso();
      let decisionId = blocker.decision_id;

      if (decisionId) {
        run(`UPDATE decisions SET status = 'clarification_requested' WHERE id = ?`, [decisionId]);
      } else {
        decisionId = run(
          `INSERT INTO decisions (blocker_id, created_by, proposed_response, status, created_at)
           VALUES (?, ?, ?, 'clarification_requested', ?)`,
          [blockerId, ceoId, question, sentAt],
        );
      }

      audit({
        actorId: ceoId,
        action: 'decision.clarification_requested',
        entityType: 'decision',
        entityId: decisionId,
        summary: 'Clarification requested instead of a decision',
        metadata: { question },
      });

      const messageId = run(
        `INSERT INTO messages (sender_id, recipient_id, decision_id, body, sent_at)
         VALUES (?, ?, ?, ?, ?)`,
        [ceoId, blocker.raised_by_id, decisionId, question, sentAt],
      );

      audit({
        actorId: ceoId,
        action: 'message.sent',
        entityType: 'message',
        entityId: messageId,
        summary: `Question sent to ${blocker.raised_by_name ?? 'the author'} on "${blocker.title}"`,
      });

      // Status deliberately unchanged: a question is not a decision.
      return { ok: true, message: 'Question sent. The blocker is still awaiting a decision.' };
    });
  } catch (err) {
    return { ok: false, message: 'Nothing was sent - the write failed.', error: (err as Error).message };
  } finally {
    revalidateAll();
  }
}

/** The only path to resolved. Never reached by acknowledgement. */
export async function resolveBlocker(form: FormData): Promise<SubmitResult> {
  const auth = await authorize('ceo');
  if (!auth.ok) return { ok: false, message: auth.message };
  const blockerId = int(form, 'blockerId');
  const actorId = int(form, 'actorId');
  const blocker = blockerId === null ? undefined : getBlocker(blockerId);
  if (!blocker || actorId === null) return { ok: false, message: 'Missing blocker.' };

  try {
    return tx(() => {
      run(`UPDATE blockers SET status = 'resolved', resolved_at = ? WHERE id = ?`, [nowIso(), blockerId]);
      audit({
        actorId,
        action: 'blocker.resolved',
        entityType: 'blocker',
        entityId: blockerId,
        summary: `Blocker explicitly resolved: ${blocker.title}`,
      });

      return { ok: true, message: 'Blocker resolved.' };
    });
  } catch (err) {
    return { ok: false, message: 'The blocker was not resolved.', error: (err as Error).message };
  } finally {
    revalidateAll();
  }
}

// --------------------------------------------------------------------------
// Employee acknowledges guidance
// --------------------------------------------------------------------------

/**
 * Acknowledgement records that the guidance was READ. It does not resolve the
 * blocker, and the interface says so where the button is.
 */
export async function acknowledgeMessage(form: FormData): Promise<SubmitResult> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, message: auth.message };
  const messageId = int(form, 'messageId');
  const userId = int(form, 'userId');
  const note = optionalText(form, 'note');

  const message = messageId === null ? undefined : getMessage(messageId);
  if (!message || userId === null) return { ok: false, message: 'That message no longer exists.' };
  if (message.acknowledged_at) return { ok: true, message: 'Already acknowledged.' };

  try {
    return tx(() => {
      run('UPDATE messages SET acknowledged_at = ?, ack_note = ? WHERE id = ?', [nowIso(), note, messageId]);
      audit({
        actorId: userId,
        action: 'message.acknowledged',
        entityType: 'message',
        entityId: messageId,
        summary:
          'Guidance acknowledged. The blocker stays open - acknowledgement is not resolution.',
        metadata: { note },
      });
      return {
        ok: true,
        message: 'Acknowledged. The blocker is still open until it is explicitly resolved.',
      };
    });
  } catch (err) {
    return { ok: false, message: 'Acknowledgement failed.', error: (err as Error).message };
  } finally {
    revalidateAll();
  }
}

// --------------------------------------------------------------------------
// Schedule
// --------------------------------------------------------------------------

/**
 * Replaces any existing proposal for the day with a new one. Approved blocks
 * are left alone - a proposal never overwrites something a human approved.
 */
export async function proposeSchedule(form: FormData): Promise<SubmitResult & { proposal?: Proposal }> {
  const ownerId = int(form, 'ownerId');
  const planDate = text(form, 'planDate');
  const request = text(form, 'request');

  if (ownerId === null || !/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
    return { ok: false, message: 'Pick a day to plan.' };
  }
  if (request.length < 3) {
    return { ok: false, message: 'Describe the priorities for the day first.' };
  }

  const proposal = planDay(request, planDate);
  if (proposal.blocks.length === 0) {
    return {
      ok: false,
      message: 'Nothing in that could be read as an activity. Try listing the items separated by commas.',
    };
  }

  try {
    const result = tx(() => {
      run(`DELETE FROM schedule_items WHERE owner_id = ? AND plan_date = ? AND status = 'proposed'`, [
        ownerId,
        planDate,
      ]);

      for (const block of proposal.blocks) {
        run(
          `INSERT INTO schedule_items (owner_id, title, start_at, end_at, priority, source_text,
                                       is_assumed_duration, is_assumed_time, plan_date, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)`,
          [
            ownerId,
            block.title,
            block.startAt,
            block.endAt,
            block.priority,
            block.sourceText,
            block.isAssumedDuration ? 1 : 0,
            block.isAssumedTime ? 1 : 0,
            planDate,
            nowIso(),
          ],
        );
      }

      audit({
        actorId: ownerId,
        action: 'schedule.proposed',
        entityType: 'schedule_item',
        entityId: null,
        summary: `${proposal.blocks.length} blocks proposed for ${planDate} (not yet approved)`,
        metadata: { request, conflicts: proposal.conflicts.map((c) => c.message), unplaced: proposal.unplaced },
      });

      return {
        ok: true,
        message:
          proposal.conflicts.length > 0
            ? `Proposed ${proposal.blocks.length} blocks. ${proposal.conflicts.length} overlap flagged - nothing was dropped.`
            : `Proposed ${proposal.blocks.length} blocks. Review the assumptions, then approve.`,
      };
    });
    return { ...result, proposal };
  } catch (err) {
    return { ok: false, message: 'The proposal was not saved.', error: (err as Error).message };
  } finally {
    revalidateAll();
  }
}

export async function updateScheduleItem(form: FormData): Promise<SubmitResult> {
  const auth = await authorize('ceo');
  if (!auth.ok) return { ok: false, message: auth.message };
  const id = int(form, 'itemId');
  const ownerId = int(form, 'ownerId');
  const title = text(form, 'title');
  const startTime = text(form, 'startTime'); // HH:mm
  const endTime = text(form, 'endTime');
  const planDate = text(form, 'planDate');

  if (id === null || ownerId === null || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    return { ok: false, message: 'Give the block a valid start and end time (HH:MM).' };
  }
  if (title.length < 2) return { ok: false, message: 'The block needs a title.' };

  const startAt = new Date(`${planDate}T${startTime}:00`);
  const endAt = new Date(`${planDate}T${endTime}:00`);
  if (!(endAt > startAt)) {
    return { ok: false, message: 'The block has to end after it starts.' };
  }

  try {
    return tx(() => {
      // An edited block is no longer an assumed time or duration: a human set
      // both, so the assumption markers come off.
      run(
        `UPDATE schedule_items
         SET title = ?, start_at = ?, end_at = ?, is_assumed_duration = 0, is_assumed_time = 0
         WHERE id = ? AND owner_id = ?`,
        [title, startAt.toISOString(), endAt.toISOString(), id, ownerId],
      );
      audit({
        actorId: ownerId,
        action: 'schedule.edited',
        entityType: 'schedule_item',
        entityId: id,
        summary: `Block edited to ${startTime}-${endTime}: ${title}`,
      });
      return { ok: true, message: 'Block updated.' };
    });
  } catch (err) {
    return { ok: false, message: 'The block was not changed.', error: (err as Error).message };
  } finally {
    revalidateAll();
  }
}

export async function discardScheduleItem(form: FormData): Promise<SubmitResult> {
  const auth = await authorize('ceo');
  if (!auth.ok) return { ok: false, message: auth.message };
  const id = int(form, 'itemId');
  const ownerId = int(form, 'ownerId');
  if (id === null || ownerId === null) return { ok: false, message: 'Missing block.' };

  try {
    return tx(() => {
      // Status change, not a delete: demo business records are never hard
      // deleted, so the trail stays intact.
      run(`UPDATE schedule_items SET status = 'discarded' WHERE id = ? AND owner_id = ?`, [id, ownerId]);
      audit({
        actorId: ownerId,
        action: 'schedule.discarded',
        entityType: 'schedule_item',
        entityId: id,
        summary: 'Block discarded by the owner',
      });
      return { ok: true, message: 'Block discarded.' };
    });
  } catch (err) {
    return { ok: false, message: 'The block was not discarded.', error: (err as Error).message };
  } finally {
    revalidateAll();
  }
}

export async function approveSchedule(form: FormData): Promise<SubmitResult> {
  const auth = await authorize('ceo');
  if (!auth.ok) return { ok: false, message: auth.message };
  const ownerId = int(form, 'ownerId');
  const planDate = text(form, 'planDate');
  if (ownerId === null || !/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
    return { ok: false, message: 'Missing day.' };
  }

  try {
    return tx(() => {
      const items = run(
        `UPDATE schedule_items SET status = 'approved'
         WHERE owner_id = ? AND plan_date = ? AND status = 'proposed'`,
        [ownerId, planDate],
      );
      void items;
      audit({
        actorId: ownerId,
        action: 'schedule.approved',
        entityType: 'schedule_item',
        entityId: null,
        summary: `Schedule approved for ${planDate}`,
      });
      return { ok: true, message: 'Schedule approved. It persists across navigation and restarts.' };
    });
  } catch (err) {
    return { ok: false, message: 'The schedule was not approved.', error: (err as Error).message };
  } finally {
    revalidateAll();
  }
}

// --------------------------------------------------------------------------
// Demo reset
// --------------------------------------------------------------------------

/**
 * Drops everything and reseeds. Same code path as npm run seed, so the counts
 * after a reset match the counts you rehearsed with.
 */
export async function resetDemo(): Promise<SubmitResult> {
  const auth = await authorize('ceo');
  if (!auth.ok) return { ok: false, message: auth.message };
  try {
    seedDemoWorkspace();
    revalidateAll();
    return { ok: true, message: 'Demo workspace reset to the seeded state.' };
  } catch (err) {
    return { ok: false, message: 'Reset failed.', error: (err as Error).message };
  }
}

// --------------------------------------------------------------------------
// Chief of staff panel
// --------------------------------------------------------------------------

/**
 * The spoken briefing and the question answering behind the avatar.
 *
 * Both are read-only and both run server-side, so the panel can never say
 * something that is not in the database - and cannot change anything either.
 */
export async function getBriefing(): Promise<Briefing> {
  const auth = await authorize('ceo');
  if (!auth.ok) throw new Error(auth.message);
  return buildBriefing(auth.user);
}

export async function askChief(question: string): Promise<Answer> {
  const auth = await authorize('ceo');
  if (!auth.ok) throw new Error(auth.message);
  return answerQuestion(question, auth.user);
}

/**
 * Adds a comment to a blocker's discussion.
 *
 * Deliberately separate from the decision flow: a comment is talk about the
 * blocker, not an instruction. It does not send a message, does not create a
 * decision, and does not change the blocker's status. Only "Approve and send"
 * does that, and only resolving does the other.
 */
export async function addBlockerComment(form: FormData): Promise<SubmitResult> {
  const auth = await authorize('ceo');
  if (!auth.ok) return { ok: false, message: auth.message };
  const blockerId = int(form, 'blockerId');
  const authorId = int(form, 'authorId');
  const body = text(form, 'body').trim();

  if (blockerId === null || authorId === null) {
    return { ok: false, message: 'That blocker no longer exists.' };
  }
  if (body.length === 0) {
    return { ok: false, message: 'Write a comment before posting.' };
  }

  const blocker = getBlocker(blockerId);
  const author = getUser(authorId);
  if (!blocker || !author) return { ok: false, message: 'That blocker no longer exists.' };

  try {
    return tx(() => {
      run('INSERT INTO blocker_comments (blocker_id, author_id, body, created_at) VALUES (?, ?, ?, ?)', [
        blockerId,
        authorId,
        body,
        nowIso(),
      ]);
      audit({
        actorId: authorId,
        action: 'blocker.commented',
        entityType: 'blocker',
        entityId: blockerId,
        summary: `${author.name} commented on "${blocker.title}". The blocker status is unchanged.`,
        metadata: { body },
      });
      revalidateAll();
      return { ok: true, message: 'Comment posted.' };
    });
  } catch {
    return { ok: false, message: 'Could not post that comment.' };
  }
}
