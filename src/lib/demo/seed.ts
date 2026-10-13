/**
 * Seeds the ChiefOS demo workspace.
 *
 * Called by scripts/seed.ts (npm run seed / npm run reset) and by the reset
 * button in the app, so the demo can be put back to a known state on stage
 * without leaving the browser.
 *
 * Division of labour, deliberately:
 *   - Every record that appears on screen during the demo is HAND-WRITTEN.
 *     Generated prose reads as mush the moment somebody actually reads it,
 *     and in a pitch somebody always reads one closely.
 *   - faker produces filler only: older background updates and audit noise.
 *
 * Reproducibility: faker is seeded, so a reset reproduces the same counts and
 * the same filler text every time. Timestamps are anchored to "now" so the
 * dashboard always looks current.
 *
 * Everything here is fictional.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { faker } from '@faker-js/faker';
import { initSchema, run, tx } from '../db/core';
import { extractWithRules } from '../ai/rules';
import type { Extraction, ExtractionContext } from '../ai/types';
import { hashPassword } from '../auth/password';
import { DEPARTMENTS } from './constants';

/**
 * Demo credentials, printed by the seed script so they are discoverable
 * without reading the source. Fictional workspace, fictional passwords - and
 * they are still hashed, because a seed file is where a plaintext password
 * quietly becomes a permanent habit.
 */
export const DEMO_PASSWORDS = {
  ceo: 'ceo-demo-2026',
  employee: 'team-demo-2026',
} as const;

faker.seed(20261013);

mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });

// --------------------------------------------------------------------------
// Time helpers. Everything is anchored to the moment of seeding.
// --------------------------------------------------------------------------

const NOW = new Date();

function iso(date: Date): string {
  return date.toISOString();
}

function daysAgo(days: number, hour = 10, minute = 0): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return iso(d);
}

function daysAhead(days: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  d.setHours(18, 0, 0, 0);
  return iso(d);
}

function dateOnly(offsetDays: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function atHour(offsetDays: number, hour: number, minute = 0): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return iso(d);
}

// --------------------------------------------------------------------------
// Insert helpers
// --------------------------------------------------------------------------

function insertAudit(entry: {
  actorId: number | null;
  action: string;
  entityType: string;
  entityId: number | null;
  summary: string;
  createdAt: string;
}): void {
  run(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, summary, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [entry.actorId, entry.action, entry.entityType, entry.entityId, entry.summary, entry.createdAt],
  );
}

function insertUpdate(input: {
  employeeId: number;
  projectId: number;
  taskId: number | null;
  text: string;
  createdAt: string;
  source?: 'typed' | 'voice' | 'sample';
  overrides?: Partial<Extraction>;
  ctx: ExtractionContext;
}): number {
  const extraction: Extraction = {
    ...extractWithRules(input.text, input.ctx),
    ...input.overrides,
  };
  return run(
    `INSERT INTO updates (employee_id, project_id, task_id, original_text, transcript,
                          extracted_json, source, status, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, 'submitted', ?)`,
    [
      input.employeeId,
      input.projectId,
      input.taskId,
      input.text,
      JSON.stringify(extraction),
      input.source ?? 'typed',
      input.createdAt,
    ],
  );
}

// --------------------------------------------------------------------------
// Seed
// --------------------------------------------------------------------------

export function seedDemoWorkspace(): void {
  initSchema();

  tx(() => {
    // ---- Departments -----------------------------------------------------
    const dept: Record<string, number> = {};
    for (const name of DEPARTMENTS) {
      dept[name] = run('INSERT INTO departments (name) VALUES (?)', [name]);
    }

    // ---- People ----------------------------------------------------------
    // Demo credentials. Passwords are hashed with scrypt even here - a seed
    // script is exactly where a plaintext password quietly becomes permanent.
    const ceo = run(
      `INSERT INTO users (name, role, title, department_id, username, password_hash, is_demo)
       VALUES (?, 'ceo', ?, ?, ?, ?, 1)`,
      [
        'Rohan Mehta',
        'Chief Executive Officer',
        dept['Product Engineering'],
        'rohan',
        hashPassword(DEMO_PASSWORDS.ceo),
      ],
    );

    const employee = (name: string, title: string, department: string): number => {
      const username = name.split(' ')[0].toLowerCase();
      return run(
        `INSERT INTO users (name, role, title, department_id, username, password_hash, is_demo)
         VALUES (?, 'employee', ?, ?, ?, ?, 1)`,
        [name, title, dept[department], username, hashPassword(DEMO_PASSWORDS.employee)],
      );
    };

    const aanya = employee('Aanya Sharma', 'Senior Engineer', 'Product Engineering');
    const vikram = employee('Vikram Rao', 'Engineer', 'Product Engineering');
    const nisha = employee('Nisha Verma', 'Engineering Manager', 'Product Engineering');
    const priya = employee('Priya Nair', 'Product Designer', 'Design');
    const dev = employee('Dev Patel', 'Data Engineer', 'Data');
    const meera = employee('Meera Iyer', 'Finance Analyst', 'Finance');
    const kabir = employee('Kabir Shah', 'Counsel', 'Legal');

    // ---- Projects --------------------------------------------------------
    const project = (
      name: string,
      ownerId: number,
      department: string,
      status: 'on_track' | 'at_risk' | 'blocked' | 'done',
      progress: number,
      targetInDays: number | null,
      createdDaysAgo: number,
    ): number =>
      run(
        `INSERT INTO projects (name, owner_id, department_id, status, progress, target_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          ownerId,
          dept[department],
          status,
          progress,
          targetInDays === null ? null : daysAhead(targetInDays),
          daysAgo(createdDaysAgo),
        ],
      );

    const subscriptionDashboard = project('Subscription Dashboard', aanya, 'Product Engineering', 'blocked', 70, 3, 38);
    const pricingPage = project('Pricing Page Revamp', priya, 'Design', 'at_risk', 55, 6, 31);
    const authRefactor = project('Auth Refactor', vikram, 'Product Engineering', 'done', 100, -2, 45);
    const dataMigration = project('Customer Data Migration', dev, 'Data', 'at_risk', 40, 9, 26);
    const mobileOnboarding = project('Mobile Onboarding', nisha, 'Product Engineering', 'on_track', 25, 21, 12);

    // ---- Tasks -----------------------------------------------------------
    const task = (
      projectId: number,
      title: string,
      ownerId: number,
      status: 'todo' | 'in_progress' | 'blocked' | 'done',
      dueInDays: number | null,
    ): number =>
      run(`INSERT INTO tasks (project_id, title, owner_id, status, due_date) VALUES (?, ?, ?, ?, ?)`, [
        projectId,
        title,
        ownerId,
        status,
        dueInDays === null ? null : daysAhead(dueInDays),
      ]);

    const apiIntegration = task(subscriptionDashboard, 'API integration', aanya, 'blocked', 1);
    task(subscriptionDashboard, 'Billing fields mapping', aanya, 'in_progress', 4);
    task(subscriptionDashboard, 'Usage chart component', vikram, 'done', -3);
    task(subscriptionDashboard, 'Empty and error states', aanya, 'todo', 6);

    const pricingCopy = task(pricingPage, 'Pricing copy review', priya, 'blocked', 2);
    task(pricingPage, 'Plan comparison table', priya, 'in_progress', 5);
    task(pricingPage, 'Mobile layout pass', priya, 'todo', 8);

    task(authRefactor, 'Session token rotation', vikram, 'done', -5);
    task(authRefactor, 'Password reset flow', vikram, 'done', -2);

    const eventNaming = task(dataMigration, 'Event naming audit', dev, 'blocked', 3);
    task(dataMigration, 'Schema review', dev, 'in_progress', 7);
    task(dataMigration, 'Backfill dry run', dev, 'todo', 12);

    task(mobileOnboarding, 'Onboarding wireframes', priya, 'done', -1);
    task(mobileOnboarding, 'Step one implementation', nisha, 'in_progress', 10);

    const ctx: ExtractionContext = {
      departments: [...DEPARTMENTS],
      projects: [
        'Subscription Dashboard',
        'Pricing Page Revamp',
        'Auth Refactor',
        'Customer Data Migration',
        'Mobile Onboarding',
      ],
      tasks: [
        'API integration',
        'Billing fields mapping',
        'Pricing copy review',
        'Event naming audit',
        'Schema review',
      ],
    };

    // ---- Hand-written updates (these are the ones people will read) ------
    interface Visible {
      employeeId: number;
      projectId: number;
      taskId: number | null;
      text: string;
      daysAgo: number;
      hour: number;
      overrides?: Partial<Extraction>;
    }

    const visibleUpdates: Visible[] = [
      {
        employeeId: aanya,
        projectId: subscriptionDashboard,
        taskId: apiIntegration,
        text:
          'API integration is at about 55%. The read endpoints are wired up and rendering. ' +
          'Still need the subscription status field list from Finance before I can map the write path.',
        daysAgo: 4,
        hour: 17,
      },
      {
        employeeId: priya,
        projectId: pricingPage,
        taskId: pricingCopy,
        text:
          'Plan comparison table is in review. Pricing copy is blocked on legal sign-off for the ' +
          'refund wording, which might slip past Friday.',
        daysAgo: 3,
        hour: 16,
      },
      {
        employeeId: vikram,
        projectId: authRefactor,
        taskId: null,
        text: 'Shipped the auth refactor to production this morning, no issues. Session rotation is live.',
        daysAgo: 2,
        hour: 11,
      },
      {
        employeeId: dev,
        projectId: dataMigration,
        taskId: eventNaming,
        text:
          'Halfway through the migration dry run. Need someone from Product Engineering to confirm the ' +
          'event names before I can finish the audit, otherwise the backfill may be delayed.',
        daysAgo: 2,
        hour: 15,
      },
      {
        employeeId: nisha,
        projectId: mobileOnboarding,
        taskId: null,
        text: 'Mobile onboarding is on track, about 25% in. Wireframes signed off, step one is in progress.',
        daysAgo: 1,
        hour: 10,
      },
      {
        employeeId: meera,
        projectId: subscriptionDashboard,
        taskId: null,
        text:
          'Reviewed the subscription status fields with the billing side. I can confirm four of the six; ' +
          'the trial and dunning states still need a decision on what we expose.',
        daysAgo: 1,
        hour: 14,
      },
      {
        employeeId: kabir,
        projectId: pricingPage,
        taskId: pricingCopy,
        text:
          'Refund wording review is done from my side with two small changes. Waiting on Design to ' +
          'apply them before I sign off formally.',
        daysAgo: 1,
        hour: 16,
      },
    ];

    const updateIds: Record<string, number> = {};
    for (const u of visibleUpdates) {
      const id = insertUpdate({
        employeeId: u.employeeId,
        projectId: u.projectId,
        taskId: u.taskId,
        text: u.text,
        createdAt: daysAgo(u.daysAgo, u.hour),
        overrides: u.overrides,
        ctx,
      });
      updateIds[`${u.employeeId}:${u.daysAgo}`] = id;
      insertAudit({
        actorId: u.employeeId,
        action: 'update.submitted',
        entityType: 'update',
        entityId: id,
        summary: 'Status update submitted',
        createdAt: daysAgo(u.daysAgo, u.hour),
      });
    }

    // ---- Filler updates (faker: background volume only) ------------------
    // These exist so the workspace looks lived-in. They are intentionally
    // short and unremarkable; nothing in the demo script points at them.
    const fillerPeople = [aanya, vikram, nisha, priya, dev];
    const fillerProjects = [subscriptionDashboard, pricingPage, authRefactor, dataMigration, mobileOnboarding];
    const fillerShapes = [
      'Picked up #TOPIC# today, no blockers so far.',
      'Continued on #TOPIC#. Progress is steady.',
      'Reviewed #TOPIC# with the team, notes captured.',
      'Finished the first pass on #TOPIC#.',
      'Paired on #TOPIC# this afternoon.',
    ];

    for (let i = 0; i < 24; i++) {
      const employeeId = faker.helpers.arrayElement(fillerPeople);
      const projectId = faker.helpers.arrayElement(fillerProjects);
      const topic = faker.helpers.arrayElement([
        'the query layer',
        'the test fixtures',
        'the review comments',
        'the component split',
        'the staging deploy',
        'the migration notes',
      ]);
      const text = faker.helpers.arrayElement(fillerShapes).replace('#TOPIC#', topic);
      const day = 5 + Math.floor(i / 2);
      const hour = faker.number.int({ min: 9, max: 18 });
      const id = insertUpdate({
        employeeId,
        projectId,
        taskId: null,
        text,
        createdAt: daysAgo(day, hour),
        ctx,
      });
      insertAudit({
        actorId: employeeId,
        action: 'update.submitted',
        entityType: 'update',
        entityId: id,
        summary: 'Status update submitted',
        createdAt: daysAgo(day, hour),
      });
    }

    // ---- Blockers --------------------------------------------------------
    const blocker = (input: {
      updateId: number | null;
      projectId: number;
      title: string;
      description: string;
      raisedById: number;
      ownerId: number | null;
      dependencyDepartment: string | null;
      priority: 'high' | 'medium' | 'low';
      priorityReason: string;
      status: 'open' | 'awaiting_decision' | 'decision_sent' | 'resolved';
      createdDaysAgo: number;
      resolvedDaysAgo?: number;
    }): number => {
      const id = run(
        `INSERT INTO blockers (update_id, project_id, title, description, raised_by_id, owner_id,
                               dependency_department_id, priority, priority_reason, status, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.updateId,
          input.projectId,
          input.title,
          input.description,
          input.raisedById,
          input.ownerId,
          input.dependencyDepartment ? dept[input.dependencyDepartment] : null,
          input.priority,
          input.priorityReason,
          input.status,
          daysAgo(input.createdDaysAgo, 12),
          input.resolvedDaysAgo === undefined ? null : daysAgo(input.resolvedDaysAgo, 12),
        ],
      );
      insertAudit({
        actorId: input.raisedById,
        action: 'blocker.created',
        entityType: 'blocker',
        entityId: id,
        summary: `Blocker raised: ${input.title}`,
        createdAt: daysAgo(input.createdDaysAgo, 12),
      });
      return id;
    };

    // 1 - open, high: the one the live demo update will sit next to
    blocker({
      updateId: updateIds[`${aanya}:4`] ?? null,
      projectId: subscriptionDashboard,
      title: 'Subscription status field list not confirmed by Finance',
      description:
        'The write path cannot be mapped until Finance confirms which subscription status values are ' +
        'authoritative, in particular trial and dunning.',
      raisedById: aanya,
      ownerId: meera,
      dependencyDepartment: 'Finance',
      priority: 'high',
      priorityReason:
        'Blocking two downstream tasks on a project due in three days, and the dependency sits outside the owning team.',
      status: 'open',
      createdDaysAgo: 4,
    });

    // 2 - awaiting_decision, high
    blocker({
      updateId: updateIds[`${priya}:3`] ?? null,
      projectId: pricingPage,
      title: 'Refund wording needs a call on the 14-day clause',
      description:
        'Legal has reviewed and proposed two changes. Whether we keep the 14-day clause on the pricing ' +
        'page is a commercial decision, not a legal one.',
      raisedById: priya,
      ownerId: kabir,
      dependencyDepartment: 'Legal',
      priority: 'high',
      priorityReason:
        'Needs an executive call rather than a team decision, and the launch date is six days out.',
      status: 'awaiting_decision',
      createdDaysAgo: 3,
    });

    // 3 - awaiting_decision, medium
    const eventNamingBlocker = blocker({
      updateId: updateIds[`${dev}:2`] ?? null,
      projectId: dataMigration,
      title: 'Event naming convention not agreed across teams',
      description:
        'Data and Product Engineering are using different names for the same three events. The backfill ' +
        'cannot start until one convention is chosen.',
      raisedById: dev,
      ownerId: nisha,
      dependencyDepartment: 'Product Engineering',
      priority: 'medium',
      priorityReason:
        'Two teams are blocked on each other with no owner; the migration window is nine days away.',
      status: 'awaiting_decision',
      createdDaysAgo: 2,
    });

    // 4 - decision_sent, medium
    const vendorBlocker = blocker({
      updateId: null,
      projectId: dataMigration,
      title: 'Export tooling budget approval',
      description: 'The one-off export tool needs a small spend approval before the vendor will enable the account.',
      raisedById: dev,
      ownerId: meera,
      dependencyDepartment: 'Finance',
      priority: 'medium',
      priorityReason: 'Single approval unblocks the whole migration path; no technical work is waiting behind it yet.',
      status: 'decision_sent',
      createdDaysAgo: 6,
    });

    // 5 - open, low
    blocker({
      updateId: null,
      projectId: mobileOnboarding,
      title: 'Illustration style not chosen for onboarding steps',
      description: 'Two directions are on the table. Either works; nobody has picked one.',
      raisedById: nisha,
      ownerId: priya,
      dependencyDepartment: 'Design',
      priority: 'low',
      priorityReason: 'Cosmetic and reversible, with three weeks of runway before it affects delivery.',
      status: 'open',
      createdDaysAgo: 5,
    });

    // 6 and 7 - resolved
    const stagingBlocker = blocker({
      updateId: null,
      projectId: authRefactor,
      title: 'Staging environment missing the new session keys',
      description: 'Rotation could not be tested end to end until staging had the new key pair.',
      raisedById: vikram,
      ownerId: nisha,
      dependencyDepartment: 'Product Engineering',
      priority: 'high',
      priorityReason: 'Held the only remaining verification step on a project that was otherwise complete.',
      status: 'resolved',
      createdDaysAgo: 11,
      resolvedDaysAgo: 8,
    });

    const copyBlocker = blocker({
      updateId: null,
      projectId: pricingPage,
      title: 'Plan names inconsistent between app and marketing site',
      description: 'Three plans were named differently in two places. Needed one source of truth.',
      raisedById: priya,
      ownerId: nisha,
      dependencyDepartment: 'Product Engineering',
      priority: 'medium',
      priorityReason: 'Visible to customers on launch, and the fix required agreement rather than work.',
      status: 'resolved',
      createdDaysAgo: 14,
      resolvedDaysAgo: 10,
    });

    // ---- Decisions, with realistic response text -------------------------
    const decision = (input: {
      blockerId: number | null;
      proposed: string;
      approved: string | null;
      status: 'draft' | 'approved' | 'sent' | 'clarification_requested';
      createdDaysAgo: number;
      approvedDaysAgo?: number;
      recipientId?: number;
      acknowledgedDaysAgo?: number;
      ackNote?: string;
    }): number => {
      const id = run(
        `INSERT INTO decisions (blocker_id, created_by, proposed_response, approved_response, status, created_at, approved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.blockerId,
          ceo,
          input.proposed,
          input.approved,
          input.status,
          daysAgo(input.createdDaysAgo, 13),
          input.approvedDaysAgo === undefined ? null : daysAgo(input.approvedDaysAgo, 13),
        ],
      );
      insertAudit({
        actorId: ceo,
        action: 'decision.drafted',
        entityType: 'decision',
        entityId: id,
        summary: 'Response drafted for review',
        createdAt: daysAgo(input.createdDaysAgo, 13),
      });

      if (input.approvedDaysAgo !== undefined) {
        insertAudit({
          actorId: ceo,
          action: 'decision.approved',
          entityType: 'decision',
          entityId: id,
          summary: 'Response approved by the CEO',
          createdAt: daysAgo(input.approvedDaysAgo, 13),
        });
      }

      if (input.recipientId && input.approved) {
        const messageId = run(
          `INSERT INTO messages (sender_id, recipient_id, decision_id, body, sent_at, acknowledged_at, ack_note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            ceo,
            input.recipientId,
            id,
            input.approved,
            daysAgo(input.approvedDaysAgo ?? input.createdDaysAgo, 13),
            input.acknowledgedDaysAgo === undefined ? null : daysAgo(input.acknowledgedDaysAgo, 14),
            input.ackNote ?? null,
          ],
        );
        insertAudit({
          actorId: ceo,
          action: 'message.sent',
          entityType: 'message',
          entityId: messageId,
          summary: 'Guidance sent to the person who raised the blocker',
          createdAt: daysAgo(input.approvedDaysAgo ?? input.createdDaysAgo, 13),
        });
        if (input.acknowledgedDaysAgo !== undefined) {
          insertAudit({
            actorId: input.recipientId,
            action: 'message.acknowledged',
            entityType: 'message',
            entityId: messageId,
            summary: 'Guidance acknowledged (the blocker stays open until explicitly resolved)',
            createdAt: daysAgo(input.acknowledgedDaysAgo, 14),
          });
        }
      }
      return id;
    };

    // Three fully resolved decisions with real response text.
    decision({
      blockerId: stagingBlocker,
      proposed: 'Ask Platform to copy the new key pair into staging today.',
      approved:
        'Nisha to have the new session key pair in staging by end of day today. Vikram, verify rotation ' +
        'end to end tomorrow morning and reply here with the result. If the keys are not in place by 6pm, ' +
        'escalate to me directly rather than waiting another day.',
      status: 'sent',
      createdDaysAgo: 10,
      approvedDaysAgo: 9,
      recipientId: vikram,
      acknowledgedDaysAgo: 9,
      ackNote: 'Understood, will verify tomorrow morning and report back.',
    });

    decision({
      blockerId: copyBlocker,
      proposed: 'Pick the app names as canonical and update marketing.',
      approved:
        'We use the in-app plan names as the single source of truth: Starter, Growth, Scale. Priya to ' +
        'update the marketing site copy this week. Any future rename goes through Nisha before it ships ' +
        'to either surface.',
      status: 'sent',
      createdDaysAgo: 13,
      approvedDaysAgo: 12,
      recipientId: priya,
      acknowledgedDaysAgo: 12,
      ackNote: 'Noted. Marketing copy updated and pushed to review.',
    });

    decision({
      blockerId: vendorBlocker,
      proposed: 'Approve the export tooling spend for one month.',
      approved:
        'Approved for one month at the quoted rate, charged to the migration line. Dev to confirm the ' +
        'account is enabled within two days. If the migration needs it beyond a month, come back with ' +
        'actual usage rather than an estimate.',
      status: 'sent',
      createdDaysAgo: 5,
      approvedDaysAgo: 5,
      recipientId: dev,
      acknowledgedDaysAgo: 4,
      ackNote: 'Thanks, chasing the vendor today.',
    });

    // A draft awaiting the CEO on the event-naming blocker, so the inbox is
    // not a single row during the demo.
    decision({
      blockerId: eventNamingBlocker,
      proposed:
        'Product Engineering owns the event naming convention. Data to adopt the existing names and ' +
        'raise exceptions individually rather than renaming in bulk.',
      approved: null,
      status: 'draft',
      createdDaysAgo: 1,
    });

    // ---- Approved schedule for today (the demo plans tomorrow) -----------
    const scheduleItem = (input: {
      title: string;
      startHour: number;
      startMinute?: number;
      durationMinutes: number;
      priority: 'high' | 'medium' | 'low';
      sourceText: string;
      assumedDuration?: boolean;
      assumedTime?: boolean;
    }): void => {
      const start = atHour(0, input.startHour, input.startMinute ?? 0);
      const end = new Date(new Date(start).getTime() + input.durationMinutes * 60_000);
      const id = run(
        `INSERT INTO schedule_items (owner_id, title, start_at, end_at, priority, source_text,
                                     is_assumed_duration, is_assumed_time, plan_date, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)`,
        [
          ceo,
          input.title,
          start,
          iso(end),
          input.priority,
          input.sourceText,
          input.assumedDuration ? 1 : 0,
          input.assumedTime ? 1 : 0,
          dateOnly(0),
          daysAgo(1, 19),
        ],
      );
      insertAudit({
        actorId: ceo,
        action: 'schedule.approved',
        entityType: 'schedule_item',
        entityId: id,
        summary: `Schedule block approved: ${input.title}`,
        createdAt: daysAgo(1, 19),
      });
    };

    scheduleItem({
      title: 'Review subscription dashboard blocker',
      startHour: 9,
      durationMinutes: 45,
      priority: 'high',
      sourceText: 'review the subscription dashboard blocker first thing',
    });
    scheduleItem({
      title: 'Pricing launch readiness with Design and Legal',
      startHour: 11,
      durationMinutes: 60,
      priority: 'high',
      sourceText: 'pricing launch readiness with design and legal',
      assumedDuration: true,
    });
    scheduleItem({
      title: 'Hold for urgent issues',
      startHour: 15,
      durationMinutes: 60,
      priority: 'medium',
      sourceText: 'keep some time for urgent issues',
      assumedDuration: true,
      assumedTime: true,
    });

    // ---- Audit noise, so the trail reads as two weeks of real use --------
    const auditShapes: Array<[string, string, string]> = [
      ['project.viewed', 'project', 'Project health reviewed on the Command Center'],
      ['blocker.viewed', 'blocker', 'Blocker opened from the decision inbox'],
      ['update.viewed', 'update', 'Update opened with original wording'],
      ['activity.viewed', 'audit_log', 'Activity history reviewed'],
    ];
    for (let i = 0; i < 26; i++) {
      const [action, entityType, summary] = faker.helpers.arrayElement(auditShapes);
      insertAudit({
        actorId: faker.helpers.arrayElement([ceo, aanya, vikram, nisha, priya, dev]),
        action,
        entityType,
        entityId: null,
        summary,
        createdAt: daysAgo(faker.number.int({ min: 1, max: 14 }), faker.number.int({ min: 9, max: 19 })),
      });
    }
  });
}
