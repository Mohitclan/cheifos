import 'server-only';
import {
  getBlockersForProject,
  getDueSoonTasks,
  getInboxBlockers,
  getKpis,
  getMessagesForUser,
  getProjects,
  getRecentUpdates,
  getNextScheduledDate,
  getScheduleForDate,
  getSentBlockers,
  getTasksForProject,
  getUpdatesForEmployee,
  getUsers,
  type UserRow,
} from '@/lib/db/queries';
import { ago, clock, dayShort, dueLabel, todayIso, tomorrowIso } from '@/lib/format';
import { gapLabel, getMissingToday } from '@/lib/reporting';
import { getTodaysMeetings } from '@/lib/alerts';

/**
 * Question answering for the chief-of-staff panel.
 *
 * Deliberately NOT a language model, and not pretending to be one. A question
 * is matched to one of a fixed set of intents by keyword score, the intent
 * runs a real query, and the answer is assembled from the rows it returns.
 *
 * The important behaviour is the last one in the list: when nothing matches
 * well enough, it says so and lists what it can actually answer. An assistant
 * that admits the edge of its knowledge is worth more than one that
 * improvises past it - and improvising here would mean inventing facts about
 * someone's project.
 */

export interface Answer {
  /** Spoken and shown. */
  speech: string;
  detail: string[];
  tone: 'neutral' | 'blocked' | 'risk' | 'ok' | 'accent';
  href?: string;
  /** True when the question fell outside what the records can answer. */
  unanswered: boolean;
  /** Real records to render, rather than a list of sentences about them. */
  cards?: AnswerCard[];
}

/**
 * A record the answer is about, rendered as itself.
 *
 * The point of the console is that asking brings you the thing, not a
 * paragraph describing the thing - so an answer carries rows, and the rows
 * carry whatever action is available on them.
 */
export interface AnswerCard {
  id: string;
  kind: 'blocker' | 'meeting' | 'person' | 'project';
  title: string;
  subtitle?: string;
  body?: string;
  meta?: string;
  tone: Answer['tone'];
  href?: string;
  action?: AnswerAction;
}

/**
 * Something the CEO can do from here.
 *
 * The agent only ever STAGES this. `preview` is the exact text that would be
 * sent, shown before anything happens, and the send is a separate press. The
 * console is a shorter path to the same approval, never a way around it.
 */
export interface AnswerAction {
  kind: 'approve_decision' | 'request_clarification';
  label: string;
  blockerId: number;
  /** Exactly what gets sent. Never hidden behind the button. */
  preview: string;
}

type Intent =
  | 'decisions'
  | 'blockers'
  | 'due'
  | 'schedule'
  | 'projects'
  | 'activity'
  | 'inbox'
  | 'meetings'
  | 'quiet'
  | 'guide'
  | 'capabilities';

/** Keyword sets per intent. Scored by how many distinct terms appear. */
const INTENT_TERMS: Record<Intent, string[]> = {
  decisions: ['need me', 'needs me', 'waiting on me', 'decide', 'decision', 'decisions', 'approve', 'my attention', 'action'],
  blockers: ['blocked', 'blocker', 'blockers', 'stuck', 'holding', 'escalation', 'escalations'],
  due: ['due', 'deadline', 'deadlines', 'overdue', 'late', 'this week', 'soon'],
  // Declared before `schedule`, and without the meeting words: a question
  // about meetings should get who and what, not a list of time blocks. Ties in
  // scoreIntent go to whichever is declared first, so order is the mechanism.
  meetings: [
    'meeting', 'meetings', 'who am i meeting', 'call', 'calls', 'appointment',
    'appointments', 'am i meeting', 'any meetings', 'next meeting',
  ],
  schedule: ['schedule', 'calendar', 'day', 'today', 'tomorrow', 'plan', 'diary', 'next up'],
  projects: ['project', 'projects', 'status', 'health', 'progress', 'how is', 'how are', 'going'],
  activity: ['happened', 'changed', 'since', 'yesterday', 'recent', 'latest', 'update', 'updates', 'news', 'activity'],
  inbox: ['my inbox', 'messages', 'guidance', 'replied', 'reply', 'acknowledge', 'told me'],
  quiet: [
    'who has not', 'who hasn', 'not reported', 'not filed', 'not submitted',
    'who is quiet', 'who went quiet', 'missing update', 'missing updates',
    'who is missing', 'nobody heard', 'not heard from', 'silent', 'no update from',
  ],
  guide: [
    'where do i', 'where can i', 'where is', 'how do i', 'how can i', 'how to',
    'what should i do', 'what do i do', 'take me', 'show me where', 'guide me',
    'walk me', 'find the', 'which page', 'where would i',
  ],
  capabilities: ['what can you', 'help', 'who are you', 'what do you do', 'commands', 'ask you'],
};

/** Phrasings that mean "show me how", whatever the task turns out to be. */
const GUIDE_TRIGGERS = [
  'where do i', 'where can i', 'where is the', 'where would i', 'which page',
  'how do i', 'how can i', 'how to ', 'what should i do', 'what do i do',
  'take me to', 'show me where', 'guide me', 'walk me through',
];

/**
 * Where each task lives and what doing it actually involves.
 *
 * This is the "show me where" half of the assistant. Matching is on the verb
 * the person used, not on the page name, because someone asking for help does
 * not know what the page is called yet.
 */
const GUIDE_STEPS: Array<{ terms: string[]; task: string; where: string; href: string; steps: string[] }> = [
  {
    terms: ['approve', 'respond', 'reply to', 'answer', 'decision', 'decide', 'guidance', 'send'],
    task: 'Respond to something that needs your decision',
    where: 'Decision Inbox',
    href: '/decisions',
    steps: [
      'Each card shows the original wording beside what was read from it, and why it is prioritised.',
      'Edit the drafted response - it is a draft, nothing has been sent.',
      'Press Approve and send. That is the only thing that sends it.',
      'If it is not clear enough to answer, use Ask for clarification instead.',
    ],
  },
  {
    terms: ['comment', 'discuss', 'talk about', 'note on', 'thread'],
    task: 'Discuss a blocker without deciding it yet',
    where: 'Decision Inbox, under each blocker',
    href: '/decisions',
    steps: [
      'Open Discuss this blocker at the bottom of the card.',
      'Comments stay on the blocker. They are not sent to anyone and do not change its status.',
      'Use this when you want to think out loud or record who you spoke to.',
    ],
  },
  {
    terms: ['plan', 'schedule', 'tomorrow', 'calendar', 'time block', 'diary'],
    task: 'Plan your day',
    where: 'Schedule',
    href: '/schedule',
    steps: [
      'Type your priorities in plain words, the way you would say them.',
      'Blocks are placed by the app, not by a model. Anything assumed is labelled.',
      'Overlaps are flagged and both blocks are kept - adjust one, then approve.',
      'Nothing is final until you press Approve.',
    ],
  },
  {
    terms: ['update', 'submit', 'report', 'standup', 'employee', 'as aanya', 'write'],
    task: 'Submit an update as an employee',
    where: 'Employee Workspace',
    href: '/employee',
    steps: [
      'Pick the project, then write the update the way you would say it in a standup.',
      'Press Check what this says to see the fields that were read from it.',
      'Correct anything that is wrong - what you confirm is what gets saved.',
      'Submit. The blocker then appears in the Decision Inbox.',
    ],
  },
  {
    terms: ['acknowledge', 'acknowledgement', 'read receipt', 'confirm receipt'],
    task: 'Acknowledge guidance you were sent',
    where: 'Employee Workspace, right-hand inbox',
    href: '/employee',
    steps: [
      'Switch identity to the employee in the top bar.',
      'The approved guidance is in Your inbox.',
      'Acknowledging records that you read it. It does not resolve the blocker.',
    ],
  },
  {
    terms: ['history', 'audit', 'who did', 'trail', 'log', 'changed'],
    task: 'See who did what, and when',
    where: 'Activity',
    href: '/activity',
    steps: [
      'Every submission, approval, send, acknowledgement and schedule approval is recorded.',
      'This is a demo audit log, not tamper-proof compliance logging.',
    ],
  },
  {
    terms: ['reset', 'start over', 'clean', 'fresh', 'rehearse'],
    task: 'Reset the demo data',
    where: 'Reset demo data, top right of every page',
    href: '/dashboard',
    steps: [
      'This rebuilds the fictional workspace from scratch.',
      'Do it immediately before presenting so your counts match what you rehearsed.',
    ],
  },
];

function scoreIntent(question: string): { intent: Intent; score: number } {
  let best: { intent: Intent; score: number } = { intent: 'capabilities', score: 0 };
  for (const [intent, terms] of Object.entries(INTENT_TERMS) as Array<[Intent, string[]]>) {
    let score = 0;
    for (const term of terms) {
      if (question.includes(term)) score += term.includes(' ') ? 2 : 1;
    }
    if (score > best.score) best = { intent, score };
  }
  return best;
}

/** Longest project name mentioned in the question, if any. */
function matchProject(question: string): string | null {
  let best: string | null = null;
  for (const project of getProjects()) {
    const name = project.name.toLowerCase();
    const distinctive = name.split(' ').filter((word) => word.length >= 5);
    const mentioned =
      question.includes(name) || (distinctive.length > 0 && distinctive.some((word) => question.includes(word)));
    if (mentioned && (!best || project.name.length > best.length)) best = project.name;
  }
  return best;
}

function matchPerson(question: string): UserRow | null {
  for (const user of getUsers()) {
    const [first] = user.name.toLowerCase().split(' ');
    if (question.includes(user.name.toLowerCase()) || question.includes(first)) return user;
  }
  return null;
}

const CAPABILITIES = [
  'what needs a decision from you',
  'what is blocked, and why each one is prioritised',
  'what is due in the next few days',
  'the status of any project by name',
  'what a particular person last reported',
  'what is on your schedule today or tomorrow',
  'what changed in the last twenty-four hours',
  'who has not filed an update',
  'what meetings you have today, and what each one is about',
];

export function answerQuestion(question: string, user: UserRow | undefined): Answer {
  const text = question.toLowerCase().trim();

  if (text.length < 2) {
    return {
      speech: 'Ask me something and I will look it up in the records.',
      detail: CAPABILITIES,
      tone: 'neutral',
      unanswered: true,
    };
  }

  // A named person or project outranks a generic keyword: "how is the pricing
  // page doing" is a question about that project, not about projects at large.
  // "Where do I ..." is an unambiguous request for navigation, so it is
  // settled before keyword scoring. Otherwise "where do I approve a decision"
  // ties with the decisions intent and answers with the list instead of the
  // directions the person actually asked for.
  if (GUIDE_TRIGGERS.some((trigger) => text.includes(trigger))) {
    return answerGuide(text);
  }

  const projectName = matchProject(text);
  const person = matchPerson(text);
  const { intent, score } = scoreIntent(text);

  if (projectName) return answerProject(projectName);
  if (person && !['decisions', 'due', 'schedule'].includes(intent)) return answerPerson(person);

  // Nothing matched with any confidence. Say so.
  if (score === 0) {
    return {
      speech:
        'I cannot answer that from the records I have, and I am not going to guess at it. ' +
        'Here is what I can tell you about.',
      detail: CAPABILITIES,
      tone: 'neutral',
      unanswered: true,
    };
  }

  switch (intent) {
    case 'decisions':
      return answerDecisions();
    case 'blockers':
      return answerBlockers();
    case 'due':
      return answerDue();
    case 'schedule':
      return answerSchedule(user);
    case 'projects':
      return answerProjects();
    case 'activity':
      return answerActivity();
    case 'inbox':
      return answerInbox(user);
    case 'meetings':
      return answerMeetings(user);
    case 'quiet':
      return answerQuiet();
    case 'guide':
      return answerGuide(text);
    case 'capabilities':
    default:
      return {
        speech:
          'I am your chief of staff for this workspace. I read the records and tell you what is in them. ' +
          'I cannot approve anything, send anything, or change anything - that stays with you.',
        detail: CAPABILITIES,
        tone: 'neutral',
        unanswered: false,
      };
  }
}

function answerDecisions(): Answer {
  const inbox = getInboxBlockers();
  if (inbox.length === 0) {
    return {
      speech: 'Nothing is waiting on a decision from you.',
      detail: [],
      tone: 'ok',
      href: '/decisions',
      unanswered: false,
    };
  }
  const top = inbox[0];
  return {
    speech:
      `${inbox.length} ${inbox.length === 1 ? 'item needs' : 'items need'} you. ` +
      `The first is ${top.title}, on ${top.project_name}. ${top.priority_reason}`,
    detail: [],
    tone: 'blocked',
    href: '/decisions',
    unanswered: false,
    cards: inbox.map((blocker) => {
      const draft = blocker.approved_response ?? blocker.proposed_response ?? '';
      return {
        id: `blocker-${blocker.id}`,
        kind: 'blocker' as const,
        title: blocker.title,
        subtitle: `${blocker.project_name}${blocker.raised_by_name ? ` · raised by ${blocker.raised_by_name}` : ''}`,
        body: blocker.priority_reason,
        meta: ago(blocker.created_at),
        tone: blocker.priority === 'high' ? ('blocked' as const) : ('risk' as const),
        href: '/decisions',
        // Only offered where a draft exists. Without one there is nothing
        // honest to preview, and a button whose text you cannot read first
        // is exactly what this product argues against.
        action: draft
          ? {
              kind: 'approve_decision' as const,
              label: 'Approve and send',
              blockerId: blocker.id,
              preview: draft,
            }
          : undefined,
      };
    }),
  };
}

function answerBlockers(): Answer {
  const open = getInboxBlockers();
  const sent = getSentBlockers();
  const total = open.length + sent.length;

  if (total === 0) {
    return { speech: 'Nothing is blocked right now.', detail: [], tone: 'ok', href: '/dashboard', unanswered: false };
  }

  return {
    speech:
      `${total} ${total === 1 ? 'blocker is' : 'blockers are'} open. ` +
      `${open.length} still ${open.length === 1 ? 'needs' : 'need'} a decision, and ` +
      `${sent.length} ${sent.length === 1 ? 'has' : 'have'} guidance sent but ${sent.length === 1 ? 'is' : 'are'} not closed yet. ` +
      // The reason is quoted verbatim rather than spliced after "because":
      // these are written as whole sentences and splicing them produces
      // "because needs an executive call".
      (open[0] ? `The highest priority is ${open[0].title}. ${open[0].priority_reason}` : ''),
    detail: [...open, ...sent].map(
      (blocker) =>
        `${blocker.status.replace(/_/g, ' ')} - ${blocker.title} (${blocker.project_name}` +
        `${blocker.dependency_department ? `, waiting on ${blocker.dependency_department}` : ''})`,
    ),
    tone: 'blocked',
    href: '/decisions',
    unanswered: false,
  };
}

function answerDue(): Answer {
  const due = getDueSoonTasks(3);
  if (due.length === 0) {
    return {
      speech: 'No unfinished task is due within the next three days.',
      detail: [],
      tone: 'ok',
      href: '/dashboard',
      unanswered: false,
    };
  }
  return {
    speech:
      `${due.length} ${due.length === 1 ? 'task is' : 'tasks are'} due within three days. ` +
      due.map((task) => `${task.title}, owned by ${task.owner_name}`).join('. ') +
      '.',
    detail: due.map((task) => `${dueLabel(task.due_date)?.text ?? ''} - ${task.title} (${task.owner_name})`),
    tone: 'risk',
    href: '/',
    unanswered: false,
  };
}

function answerSchedule(user: UserRow | undefined): Answer {
  const ownerId = user?.id ?? 0;
  const today = getScheduleForDate(ownerId, todayIso());
  const tomorrow = getScheduleForDate(ownerId, tomorrowIso());

  if (today.length === 0 && tomorrow.length === 0) {
    // Only looking at today and tomorrow meant a day planned for later in the
    // week was reported as "nothing scheduled", which is worse than unhelpful
    // - it is wrong about the person's own calendar.
    const nextDate = getNextScheduledDate(ownerId, tomorrowIso());
    if (nextDate) {
      const upcoming = getScheduleForDate(ownerId, nextDate);
      return {
        speech:
          `Today and tomorrow are both clear. Your next planned day is ${dayShort(`${nextDate}T09:00:00`)}, ` +
          `with ${upcoming.length} ${upcoming.length === 1 ? 'block' : 'blocks'}.`,
        detail: upcoming.map(
          (item) => `${clock(item.start_at)}-${clock(item.end_at)} ${item.title} (${item.status})`,
        ),
        tone: 'neutral',
        href: `/schedule?date=${nextDate}`,
        unanswered: false,
      };
    }

    return {
      speech: 'You have nothing scheduled for today or tomorrow. Tell me your priorities and I will propose blocks.',
      detail: [],
      tone: 'neutral',
      href: '/schedule',
      unanswered: false,
    };
  }

  const now = new Date();
  const next = today.find((item) => new Date(item.end_at) > now);
  const proposed = tomorrow.filter((item) => item.status === 'proposed').length;

  return {
    speech:
      (today.length
        ? `Today has ${today.length} ${today.length === 1 ? 'block' : 'blocks'}. ` +
          (next ? `Next up is ${next.title} at ${clock(next.start_at)}. ` : 'They are all behind you. ')
        : 'Nothing is scheduled today. ') +
      (tomorrow.length
        ? proposed > 0
          ? `Tomorrow has ${proposed} ${proposed === 1 ? 'block' : 'blocks'} proposed, waiting on your approval.`
          : `Tomorrow is planned with ${tomorrow.length} ${tomorrow.length === 1 ? 'block' : 'blocks'}.`
        : 'Tomorrow is empty.'),
    detail: [
      ...today.map((item) => `Today ${clock(item.start_at)}-${clock(item.end_at)} ${item.title}`),
      ...tomorrow.map(
        (item) => `Tomorrow ${clock(item.start_at)}-${clock(item.end_at)} ${item.title} (${item.status})`,
      ),
    ],
    tone: 'accent',
    href: '/schedule',
    unanswered: false,
  };
}

function answerProjects(): Answer {
  const projects = getProjects();
  const kpis = getKpis();
  return {
    speech:
      `${kpis.activeProjects} active projects. ` +
      projects
        .filter((project) => project.status !== 'done')
        .map((project) => `${project.name} is ${project.status.replace('_', ' ')} at ${project.progress} percent`)
        .join('. ') +
      '.',
    detail: projects.map(
      (project) =>
        `${project.name} - ${project.status.replace('_', ' ')}, ${project.progress}%, ${project.owner_name}` +
        `${project.open_blockers ? `, ${project.open_blockers} open blocker(s)` : ''}`,
    ),
    tone: kpis.projectsNeedingAttention > 0 ? 'risk' : 'ok',
    href: '/',
    unanswered: false,
  };
}

function answerProject(name: string): Answer {
  const project = getProjects().find((candidate) => candidate.name === name);
  if (!project) {
    return {
      speech: `I have no project called ${name}.`,
      detail: [],
      tone: 'neutral',
      unanswered: true,
    };
  }

  const blockers = getBlockersForProject(project.id).filter((blocker) => blocker.status !== 'resolved');
  const tasks = getTasksForProject(project.id);
  const open = tasks.filter((task) => task.status !== 'done').length;
  const due = dueLabel(project.target_date);

  return {
    speech:
      `${project.name} is ${project.status.replace('_', ' ')} at ${project.progress} percent, owned by ${project.owner_name}. ` +
      `${open} of ${tasks.length} tasks are still open${due ? `, and the target date reads ${due.text.toLowerCase()}` : ''}. ` +
      (blockers.length
        ? `${blockers.length} ${blockers.length === 1 ? 'blocker is' : 'blockers are'} open on it. The first is ${blockers[0].title}.`
        : 'Nothing is blocking it.'),
    detail: [
      ...blockers.map((blocker) => `Blocker - ${blocker.title} (${blocker.priority} priority)`),
      ...tasks.map((task) => `${task.status.replace('_', ' ')} - ${task.title} (${task.owner_name})`),
    ],
    tone: project.status === 'blocked' ? 'blocked' : project.status === 'at_risk' ? 'risk' : 'ok',
    href: '/',
    unanswered: false,
  };
}

function answerPerson(person: UserRow): Answer {
  const updates = getUpdatesForEmployee(person.id, 3);
  const blockers = getInboxBlockers().filter((blocker) => blocker.raised_by_id === person.id);

  if (updates.length === 0) {
    return {
      speech: `${person.name} has not submitted any updates.`,
      detail: [],
      tone: 'neutral',
      unanswered: false,
    };
  }

  const latest = updates[0];
  return {
    speech:
      `${person.name} last reported on ${latest.project_name}, ${ago(latest.created_at)}. ` +
      `Their words were: ${latest.original_text} ` +
      (blockers.length
        ? `They have ${blockers.length} ${blockers.length === 1 ? 'blocker' : 'blockers'} waiting on you.`
        : 'Nothing they raised is waiting on you.'),
    detail: updates.map((update) => `${update.project_name} - "${update.original_text}"`),
    tone: blockers.length ? 'blocked' : 'neutral',
    href: '/activity',
    unanswered: false,
  };
}

function answerActivity(): Answer {
  const updates = getRecentUpdates(5);
  if (updates.length === 0) {
    return { speech: 'No updates have been submitted yet.', detail: [], tone: 'neutral', unanswered: false };
  }
  const latest = updates[0];
  return {
    speech:
      `The most recent update is from ${latest.employee_name} on ${latest.project_name}, ${ago(latest.created_at)}. ` +
      `They wrote: ${latest.original_text}`,
    detail: updates.map(
      (update) => `${update.employee_name} on ${update.project_name} - "${update.original_text}"`,
    ),
    tone: 'neutral',
    href: '/activity',
    unanswered: false,
  };
}

function answerInbox(user: UserRow | undefined): Answer {
  if (!user) {
    return { speech: 'I do not know who you are viewing as.', detail: [], tone: 'neutral', unanswered: true };
  }
  const messages = getMessagesForUser(user.id);
  const unread = messages.filter((message) => !message.acknowledged_at);

  if (messages.length === 0) {
    return {
      speech: `Nothing has been sent to ${user.name}.`,
      detail: [],
      tone: 'neutral',
      href: '/employee',
      unanswered: false,
    };
  }

  return {
    speech:
      `${user.name} has ${messages.length} ${messages.length === 1 ? 'message' : 'messages'}, ` +
      `${unread.length} not yet acknowledged. ` +
      (unread[0] ? `The oldest unacknowledged one says: ${unread[0].body}` : ''),
    detail: messages.map(
      (message) =>
        `${message.acknowledged_at ? 'acknowledged' : 'waiting'} - ${message.blocker_title ?? 'guidance'}`,
    ),
    tone: unread.length ? 'risk' : 'ok',
    href: '/employee',
    unanswered: false,
  };
}

/**
 * "Where do I ... ?" and "how do I ... ?"
 *
 * Answers with the place and the steps, and returns an href so the panel can
 * offer to open it. When the task is not one of the ones this workspace does,
 * it lists what it can walk you through rather than improvising a procedure.
 */
function answerGuide(question: string): Answer {
  let best: (typeof GUIDE_STEPS)[number] | null = null;
  let bestScore = 0;

  for (const entry of GUIDE_STEPS) {
    let score = 0;
    for (const term of entry.terms) {
      if (question.includes(term)) score += term.includes(' ') ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  if (!best) {
    return {
      speech:
        'I can walk you through the things this workspace does, but I do not want to invent a procedure for ' +
        'something it does not. Here is what I can guide you through.',
      detail: GUIDE_STEPS.map((entry) => `${entry.task} - ${entry.where}`),
      tone: 'neutral',
      unanswered: true,
    };
  }

  return {
    speech: `${best.task}. You do that in ${best.where}.`,
    detail: best.steps,
    tone: 'accent',
    href: best.href,
    unanswered: false,
  };
}

/**
 * Who has gone quiet. The only answer here built from absent records rather
 * than present ones, so it says plainly what it is counting.
 */
function answerQuiet(): Answer {
  const missing = getMissingToday();

  if (missing.length === 0) {
    return {
      speech: 'Everyone has filed an update today. Nobody has gone quiet.',
      detail: [],
      tone: 'ok',
      unanswered: false,
    };
  }

  const overdue = missing.filter((person) => person.severity === 'overdue');

  return {
    speech:
      `${missing.length} ${missing.length === 1 ? 'person has' : 'people have'} not filed today. ` +
      (overdue.length
        ? `${overdue.length} of them ${overdue.length === 1 ? 'is' : 'are'} three or more working days behind, ` +
          `starting with ${overdue[0].name}.`
        : 'None of them are more than a day or two behind.'),
    detail: [],
    tone: overdue.length ? 'blocked' : 'risk',
    href: '/reporting',
    unanswered: false,
    cards: missing.map((person) => ({
      id: `person-${person.id}`,
      kind: 'person' as const,
      title: person.name,
      subtitle: [person.title, person.department_name].filter(Boolean).join(' · '),
      meta: gapLabel(person),
      tone: person.severity === 'overdue' ? ('blocked' as const) : ('risk' as const),
      href: '/reporting',
    })),
  };
}

/** Meetings specifically, with who and what. */
function answerMeetings(user: UserRow | undefined): Answer {
  const meetings = getTodaysMeetings(user?.id ?? 0);

  if (meetings.length === 0) {
    return {
      speech: 'You have no meetings on the plan for today. Anything on it is your own time.',
      detail: [],
      tone: 'ok',
      href: '/schedule',
      unanswered: false,
    };
  }

  const ahead = meetings.filter((alert) => alert.urgency !== 'past');

  return {
    speech: ahead.length
      ? `${ahead.length} ${ahead.length === 1 ? 'meeting' : 'meetings'} still ahead today. ${ahead[0].headline}`
      : 'Every meeting today is behind you.',
    detail: [],
    tone: ahead.length ? 'risk' : 'neutral',
    href: '/schedule',
    unanswered: false,
    cards: meetings.map((alert) => ({
      id: `meeting-${alert.item.id}`,
      kind: 'meeting' as const,
      title: alert.item.title,
      subtitle: [
        alert.item.with_whom ? `with ${alert.item.with_whom}` : null,
        alert.item.topic ? `about ${alert.item.topic}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      body: alert.item.source_text ? `You asked for: "${alert.item.source_text}"` : undefined,
      meta: `${clock(alert.item.start_at)}-${clock(alert.item.end_at)}`,
      tone: alert.urgency === 'past' ? ('neutral' as const) : ('accent' as const),
      href: '/schedule',
    })),
  };
}
