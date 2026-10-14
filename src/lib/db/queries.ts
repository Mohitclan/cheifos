import 'server-only';
import { all, count, one } from './core';

/**
 * Every read the UI performs. Raw SQL on purpose: one module, debuggable
 * under pressure, and the single swap point if persistence has to change.
 *
 * Nothing here writes. Writes live in src/lib/actions.ts so that the audit
 * row and the state change are always in the same transaction.
 */

// --------------------------------------------------------------------------
// Row types
// --------------------------------------------------------------------------

export interface UserRow {
  id: number;
  name: string;
  role: 'ceo' | 'employee';
  title: string | null;
  department: string | null;
}

export interface ProjectRow {
  id: number;
  name: string;
  status: 'on_track' | 'at_risk' | 'blocked' | 'done';
  progress: number;
  target_date: string | null;
  owner_id: number;
  owner_name: string;
  department: string;
  open_blockers: number;
}

export interface TaskRow {
  id: number;
  project_id: number;
  title: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'done';
  due_date: string | null;
  owner_name: string;
}

export interface BlockerRow {
  id: number;
  title: string;
  description: string | null;
  priority: 'high' | 'medium' | 'low';
  priority_reason: string;
  status: 'open' | 'awaiting_decision' | 'decision_sent' | 'resolved';
  created_at: string;
  resolved_at: string | null;
  project_id: number;
  project_name: string;
  raised_by_id: number | null;
  raised_by_name: string | null;
  owner_name: string | null;
  dependency_department: string | null;
  update_id: number | null;
  original_text: string | null;
  extracted_json: string | null;
  update_created_at: string | null;
  decision_id: number | null;
  decision_status: 'draft' | 'approved' | 'sent' | 'clarification_requested' | null;
  proposed_response: string | null;
  approved_response: string | null;
}

export interface UpdateRow {
  id: number;
  employee_id: number;
  employee_name: string;
  project_id: number;
  project_name: string;
  task_title: string | null;
  original_text: string;
  extracted_json: string;
  source: string;
  created_at: string;
}

export interface MessageRow {
  id: number;
  body: string;
  sent_at: string | null;
  acknowledged_at: string | null;
  ack_note: string | null;
  sender_name: string;
  decision_id: number | null;
  blocker_id: number | null;
  blocker_title: string | null;
  blocker_status: string | null;
  project_name: string | null;
}

export interface ScheduleRow {
  id: number;
  title: string;
  start_at: string;
  end_at: string;
  priority: 'high' | 'medium' | 'low';
  source_text: string | null;
  is_assumed_duration: number;
  is_assumed_time: number;
  kind: 'meeting' | 'focus';
  with_whom: string | null;
  topic: string | null;
  plan_date: string;
  status: 'proposed' | 'approved' | 'discarded';
}

export interface AuditRow {
  id: number;
  action: string;
  entity_type: string;
  entity_id: number | null;
  summary: string;
  created_at: string;
  actor_name: string | null;
  actor_role: string | null;
}

// Blocker states that still need attention. Resolved is the only terminal one.
const LIVE_BLOCKERS = `('open', 'awaiting_decision', 'decision_sent')`;

// --------------------------------------------------------------------------
// People
// --------------------------------------------------------------------------

const USER_SELECT = `
  SELECT u.id, u.name, u.role, u.title, d.name AS department
  FROM users u LEFT JOIN departments d ON d.id = u.department_id`;

export function getUsers(): UserRow[] {
  return all<UserRow>(`${USER_SELECT} ORDER BY u.role DESC, u.name`);
}

export function getUser(id: number): UserRow | undefined {
  return one<UserRow>(`${USER_SELECT} WHERE u.id = ?`, [id]);
}

export function getCeo(): UserRow | undefined {
  return one<UserRow>(`${USER_SELECT} WHERE u.role = 'ceo' ORDER BY u.id LIMIT 1`);
}

export function getEmployees(): UserRow[] {
  return all<UserRow>(`${USER_SELECT} WHERE u.role = 'employee' ORDER BY u.name`);
}

export function getDepartmentNames(): string[] {
  return all<{ name: string }>('SELECT name FROM departments ORDER BY id').map((r) => r.name);
}

export function getDepartmentIdByName(name: string): number | undefined {
  return one<{ id: number }>('SELECT id FROM departments WHERE name = ?', [name])?.id;
}

/** Any employee in the department named in an update, to own the blocker. */
export function getDepartmentContact(departmentId: number): UserRow | undefined {
  return one<UserRow>(
    `${USER_SELECT} WHERE u.department_id = ? AND u.role = 'employee' ORDER BY u.id LIMIT 1`,
    [departmentId],
  );
}

// --------------------------------------------------------------------------
// Projects and tasks
// --------------------------------------------------------------------------

const PROJECT_SELECT = `
  SELECT p.id, p.name, p.status, p.progress, p.target_date, p.owner_id,
         u.name AS owner_name, d.name AS department,
         (SELECT COUNT(*) FROM blockers b
           WHERE b.project_id = p.id AND b.status IN ${LIVE_BLOCKERS}) AS open_blockers
  FROM projects p
  JOIN users u ON u.id = p.owner_id
  JOIN departments d ON d.id = p.department_id`;

export function getProjects(): ProjectRow[] {
  return all<ProjectRow>(`${PROJECT_SELECT}
    ORDER BY CASE p.status WHEN 'blocked' THEN 0 WHEN 'at_risk' THEN 1 WHEN 'on_track' THEN 2 ELSE 3 END,
             p.target_date IS NULL, p.target_date`);
}

export function getProject(id: number): ProjectRow | undefined {
  return one<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = ?`, [id]);
}

export function getProjectsForEmployee(employeeId: number): ProjectRow[] {
  // Projects they own, plus any project they have a task on.
  return all<ProjectRow>(
    `${PROJECT_SELECT}
     WHERE p.owner_id = ?
        OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id AND t.owner_id = ?)
     ORDER BY p.name`,
    [employeeId, employeeId],
  );
}

export function getTasksForProject(projectId: number): TaskRow[] {
  return all<TaskRow>(
    `SELECT t.id, t.project_id, t.title, t.status, t.due_date, u.name AS owner_name
     FROM tasks t JOIN users u ON u.id = t.owner_id
     WHERE t.project_id = ?
     ORDER BY CASE t.status WHEN 'blocked' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END,
              t.due_date IS NULL, t.due_date`,
    [projectId],
  );
}

export function getAllTaskTitles(): string[] {
  return all<{ title: string }>('SELECT DISTINCT title FROM tasks').map((r) => r.title);
}

/** Tasks due within the window and not finished. Drives the due-soon badges. */
export function getDueSoonTasks(withinDays = 3): TaskRow[] {
  return all<TaskRow>(
    `SELECT t.id, t.project_id, t.title, t.status, t.due_date, u.name AS owner_name
     FROM tasks t JOIN users u ON u.id = t.owner_id
     WHERE t.status != 'done' AND t.due_date IS NOT NULL
       AND date(t.due_date) <= date('now', '+' || ? || ' days')
     ORDER BY t.due_date`,
    [withinDays],
  );
}

// --------------------------------------------------------------------------
// Blockers and decisions
// --------------------------------------------------------------------------

/**
 * One blocker row carries everything the Decision Inbox renders: the original
 * wording, the extraction, the priority reason, and the current draft. Joined
 * in one query so the inbox cannot show a blocker without its source text.
 */
const BLOCKER_SELECT = `
  SELECT b.id, b.title, b.description, b.priority, b.priority_reason, b.status,
         b.created_at, b.resolved_at, b.project_id, p.name AS project_name,
         b.raised_by_id, ru.name AS raised_by_name, ou.name AS owner_name,
         d.name AS dependency_department,
         b.update_id, up.original_text, up.extracted_json, up.created_at AS update_created_at,
         dec.id AS decision_id, dec.status AS decision_status,
         dec.proposed_response, dec.approved_response
  FROM blockers b
  JOIN projects p ON p.id = b.project_id
  LEFT JOIN users ru ON ru.id = b.raised_by_id
  LEFT JOIN users ou ON ou.id = b.owner_id
  LEFT JOIN departments d ON d.id = b.dependency_department_id
  LEFT JOIN updates up ON up.id = b.update_id
  LEFT JOIN decisions dec ON dec.id = (
    SELECT id FROM decisions WHERE blocker_id = b.id ORDER BY id DESC LIMIT 1
  )`;

const PRIORITY_ORDER = `CASE b.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`;

export function getBlocker(id: number): BlockerRow | undefined {
  return one<BlockerRow>(`${BLOCKER_SELECT} WHERE b.id = ?`, [id]);
}

/** The Decision Inbox: everything still waiting on a human. */
export function getInboxBlockers(): BlockerRow[] {
  return all<BlockerRow>(
    `${BLOCKER_SELECT}
     WHERE b.status IN ('open', 'awaiting_decision')
     ORDER BY ${PRIORITY_ORDER}, b.created_at DESC`,
  );
}

/** Decided but not yet resolved - kept visible so nothing silently vanishes. */
export function getSentBlockers(): BlockerRow[] {
  return all<BlockerRow>(
    `${BLOCKER_SELECT} WHERE b.status = 'decision_sent' ORDER BY ${PRIORITY_ORDER}, b.created_at DESC`,
  );
}

export function getResolvedBlockers(limit = 10): BlockerRow[] {
  return all<BlockerRow>(
    `${BLOCKER_SELECT} WHERE b.status = 'resolved' ORDER BY b.resolved_at DESC LIMIT ?`,
    [limit],
  );
}

export function getTopBlockers(limit = 4): BlockerRow[] {
  return all<BlockerRow>(
    `${BLOCKER_SELECT} WHERE b.status IN ${LIVE_BLOCKERS}
     ORDER BY ${PRIORITY_ORDER}, b.created_at LIMIT ?`,
    [limit],
  );
}

export function getBlockersForProject(projectId: number): BlockerRow[] {
  return all<BlockerRow>(
    `${BLOCKER_SELECT} WHERE b.project_id = ? ORDER BY
      CASE b.status WHEN 'resolved' THEN 1 ELSE 0 END, ${PRIORITY_ORDER}, b.created_at DESC`,
    [projectId],
  );
}

// --------------------------------------------------------------------------
// Updates
// --------------------------------------------------------------------------

const UPDATE_SELECT = `
  SELECT up.id, up.employee_id, u.name AS employee_name, up.project_id, p.name AS project_name,
         t.title AS task_title, up.original_text, up.extracted_json, up.source, up.created_at
  FROM updates up
  JOIN users u ON u.id = up.employee_id
  JOIN projects p ON p.id = up.project_id
  LEFT JOIN tasks t ON t.id = up.task_id`;

export function getRecentUpdates(limit = 8): UpdateRow[] {
  return all<UpdateRow>(`${UPDATE_SELECT} ORDER BY up.created_at DESC, up.id DESC LIMIT ?`, [limit]);
}

export function getUpdatesForEmployee(employeeId: number, limit = 10): UpdateRow[] {
  return all<UpdateRow>(
    `${UPDATE_SELECT} WHERE up.employee_id = ? ORDER BY up.created_at DESC, up.id DESC LIMIT ?`,
    [employeeId, limit],
  );
}

export function getUpdatesForProject(projectId: number, limit = 6): UpdateRow[] {
  return all<UpdateRow>(
    `${UPDATE_SELECT} WHERE up.project_id = ? ORDER BY up.created_at DESC, up.id DESC LIMIT ?`,
    [projectId, limit],
  );
}

export function getUpdate(id: number): UpdateRow | undefined {
  return one<UpdateRow>(`${UPDATE_SELECT} WHERE up.id = ?`, [id]);
}

// --------------------------------------------------------------------------
// Messages (the employee inbox)
// --------------------------------------------------------------------------

export function getMessagesForUser(userId: number): MessageRow[] {
  return all<MessageRow>(
    `SELECT m.id, m.body, m.sent_at, m.acknowledged_at, m.ack_note,
            s.name AS sender_name, m.decision_id,
            b.id AS blocker_id, b.title AS blocker_title, b.status AS blocker_status,
            p.name AS project_name
     FROM messages m
     JOIN users s ON s.id = m.sender_id
     LEFT JOIN decisions d ON d.id = m.decision_id
     LEFT JOIN blockers b ON b.id = d.blocker_id
     LEFT JOIN projects p ON p.id = b.project_id
     WHERE m.recipient_id = ? AND m.sent_at IS NOT NULL
     ORDER BY m.acknowledged_at IS NOT NULL, m.sent_at DESC`,
    [userId],
  );
}

export function getMessage(id: number): MessageRow | undefined {
  return one<MessageRow>(
    `SELECT m.id, m.body, m.sent_at, m.acknowledged_at, m.ack_note,
            s.name AS sender_name, m.decision_id,
            b.id AS blocker_id, b.title AS blocker_title, b.status AS blocker_status,
            p.name AS project_name
     FROM messages m
     JOIN users s ON s.id = m.sender_id
     LEFT JOIN decisions d ON d.id = m.decision_id
     LEFT JOIN blockers b ON b.id = d.blocker_id
     LEFT JOIN projects p ON p.id = b.project_id
     WHERE m.id = ?`,
    [id],
  );
}

// --------------------------------------------------------------------------
// Schedule
// --------------------------------------------------------------------------

export function getScheduleForDate(ownerId: number, planDate: string): ScheduleRow[] {
  return all<ScheduleRow>(
    `SELECT id, title, start_at, end_at, priority, source_text,
            is_assumed_duration, is_assumed_time, kind, with_whom, topic, plan_date, status
     FROM schedule_items
     WHERE owner_id = ? AND plan_date = ? AND status != 'discarded'
     ORDER BY start_at`,
    [ownerId, planDate],
  );
}

export function getNextScheduledDate(ownerId: number, afterDate: string): string | undefined {
  return one<{ plan_date: string }>(
    `SELECT plan_date FROM schedule_items
     WHERE owner_id = ? AND plan_date > ? AND status != 'discarded'
     ORDER BY plan_date LIMIT 1`,
    [ownerId, afterDate],
  )?.plan_date;
}

// --------------------------------------------------------------------------
// Activity
// --------------------------------------------------------------------------

export function getAuditTrail(limit = 60): AuditRow[] {
  return all<AuditRow>(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.summary, a.created_at,
            u.name AS actor_name, u.role AS actor_role
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
    [limit],
  );
}

export function getAuditForEntity(entityType: string, entityId: number): AuditRow[] {
  return all<AuditRow>(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.summary, a.created_at,
            u.name AS actor_name, u.role AS actor_role
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.entity_type = ? AND a.entity_id = ?
     ORDER BY a.created_at DESC, a.id DESC`,
    [entityType, entityId],
  );
}

// --------------------------------------------------------------------------
// Dashboard counts - every one of these is computed, never typed in
// --------------------------------------------------------------------------

export interface Kpis {
  activeProjects: number;
  projectsNeedingAttention: number;
  openBlockers: number;
  highPriorityBlockers: number;
  awaitingDecision: number;
  decisionsSentUnacknowledged: number;
  updatesThisWeek: number;
  updatesToday: number;
  dueSoon: number;
}

export function getKpis(): Kpis {
  return {
    activeProjects: count(`SELECT COUNT(*) AS n FROM projects WHERE status != 'done'`),
    projectsNeedingAttention: count(
      `SELECT COUNT(*) AS n FROM projects WHERE status IN ('at_risk', 'blocked')`,
    ),
    openBlockers: count(`SELECT COUNT(*) AS n FROM blockers WHERE status IN ${LIVE_BLOCKERS}`),
    highPriorityBlockers: count(
      `SELECT COUNT(*) AS n FROM blockers WHERE status IN ${LIVE_BLOCKERS} AND priority = 'high'`,
    ),
    awaitingDecision: count(
      `SELECT COUNT(*) AS n FROM blockers WHERE status IN ('open', 'awaiting_decision')`,
    ),
    decisionsSentUnacknowledged: count(
      `SELECT COUNT(*) AS n FROM messages WHERE sent_at IS NOT NULL AND acknowledged_at IS NULL`,
    ),
    updatesThisWeek: count(
      `SELECT COUNT(*) AS n FROM updates WHERE date(created_at) >= date('now', '-7 days')`,
    ),
    updatesToday: count(`SELECT COUNT(*) AS n FROM updates WHERE date(created_at) = date('now')`),
    dueSoon: count(
      `SELECT COUNT(*) AS n FROM tasks
       WHERE status != 'done' AND due_date IS NOT NULL
         AND date(due_date) <= date('now', '+3 days')`,
    ),
  };
}

/**
 * Guard for the empty-database case so pages can show a real empty state
 * instead of a stack trace. Also covers "database file exists but has no
 * tables yet", which is what a fresh clone looks like before npm run seed.
 */
export function isSeeded(): boolean {
  try {
    return count('SELECT COUNT(*) AS n FROM users') > 0;
  } catch {
    return false;
  }
}

export interface CommentRow {
  id: number;
  blocker_id: number;
  author_id: number;
  author_name: string;
  author_role: string;
  body: string;
  created_at: string;
}

/** Discussion on one blocker, oldest first so it reads as a conversation. */
export function getCommentsForBlocker(blockerId: number): CommentRow[] {
  return all<CommentRow>(
    `SELECT c.*, u.name AS author_name, u.role AS author_role
       FROM blocker_comments c
       JOIN users u ON u.id = c.author_id
      WHERE c.blocker_id = ?
      ORDER BY c.created_at ASC`,
    [blockerId],
  );
}

/** Comment counts for a set of blockers, so lists can show them without N queries. */
export function getCommentCounts(): Record<number, number> {
  const rows = all<{ blocker_id: number; n: number }>(
    'SELECT blocker_id, COUNT(*) AS n FROM blocker_comments GROUP BY blocker_id',
  );
  const counts: Record<number, number> = {};
  for (const row of rows) counts[row.blocker_id] = Number(row.n);
  return counts;
}

/** Lookup for sign-in. Returns the hash so the caller can verify it. */
export function getUserByUsername(username: string):
  | (UserRow & { username: string | null; password_hash: string | null })
  | undefined {
  return one(
    `SELECT u.*, d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.username = ?`,
    [username.trim().toLowerCase()],
  );
}

export interface ReportingRow {
  id: number;
  name: string;
  title: string | null;
  department_name: string | null;
  last_update_at: string | null;
  last_update_date: string | null;
}

/**
 * Last update per employee, oldest first.
 *
 * The dashboard's blind spot is the person who went quiet: a view built only
 * from what was reported cannot show you who stopped reporting, which is
 * exactly where the risk tends to sit.
 */
export function getReportingStatus(): ReportingRow[] {
  return all<ReportingRow>(
    `SELECT u.id, u.name, u.title, d.name AS department_name,
            MAX(up.created_at)      AS last_update_at,
            MAX(date(up.created_at)) AS last_update_date
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN updates up    ON up.employee_id = u.id
      WHERE u.role = 'employee'
      GROUP BY u.id
      ORDER BY last_update_at IS NULL DESC, last_update_at ASC`,
  );
}

export interface ComplianceRow extends ReportingRow {
  /** Updates filed inside the window. */
  filed_in_window: number;
  /** Distinct days filed on, so two updates in one day do not count twice. */
  days_filed: number;
  first_in_window: string | null;
}

/**
 * Filing history per employee over a date window, for the reporting report.
 * Counted by distinct day: somebody who files twice on Monday and nothing
 * else has filed on one day, not two.
 */
export function getComplianceWindow(fromDate: string, toDate: string): ComplianceRow[] {
  return all<ComplianceRow>(
    `SELECT u.id, u.name, u.title, d.name AS department_name,
            MAX(up.created_at)                                   AS last_update_at,
            MAX(date(up.created_at))                             AS last_update_date,
            COUNT(up.id)                                         AS filed_in_window,
            COUNT(DISTINCT date(up.created_at))                  AS days_filed,
            MIN(date(up.created_at))                             AS first_in_window
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN updates up    ON up.employee_id = u.id
                               AND date(up.created_at) BETWEEN ? AND ?
      WHERE u.role = 'employee'
      GROUP BY u.id
      ORDER BY days_filed ASC, u.name ASC`,
    [fromDate, toDate],
  );
}
