import 'server-only';
import {
  getBlockersForProject,
  getDueSoonTasks,
  getInboxBlockers,
  getKpis,
  getMessagesForUser,
  getProjects,
  getRecentUpdates,
  getScheduleForDate,
  getSentBlockers,
  getTasksForProject,
  getUpdatesForEmployee,
  getUsers,
  type UserRow,
} from '@/lib/db/queries';
import { ago, clock, dueLabel, todayIso, tomorrowIso } from '@/lib/format';

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
}

type Intent =
  | 'decisions'
  | 'blockers'
  | 'due'
  | 'schedule'
  | 'projects'
  | 'activity'
  | 'inbox'
  | 'capabilities';

/** Keyword sets per intent. Scored by how many distinct terms appear. */
const INTENT_TERMS: Record<Intent, string[]> = {
  decisions: ['need me', 'needs me', 'waiting on me', 'decide', 'decision', 'decisions', 'approve', 'my attention', 'action'],
  blockers: ['blocked', 'blocker', 'blockers', 'stuck', 'holding', 'escalation', 'escalations'],
  due: ['due', 'deadline', 'deadlines', 'overdue', 'late', 'this week', 'soon'],
  schedule: ['schedule', 'calendar', 'day', 'today', 'tomorrow', 'meeting', 'meetings', 'plan', 'diary', 'next up'],
  projects: ['project', 'projects', 'status', 'health', 'progress', 'how is', 'how are', 'going'],
  activity: ['happened', 'changed', 'since', 'yesterday', 'recent', 'latest', 'update', 'updates', 'news', 'activity'],
  inbox: ['my inbox', 'messages', 'guidance', 'replied', 'reply', 'acknowledge', 'told me'],
  capabilities: ['what can you', 'help', 'who are you', 'what do you do', 'commands', 'ask you'],
};

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
    detail: inbox.map(
      (blocker) =>
        `${blocker.priority.toUpperCase()} - ${blocker.title} (${blocker.project_name}, raised ${ago(blocker.created_at)})`,
    ),
    tone: 'blocked',
    href: '/decisions',
    unanswered: false,
  };
}

function answerBlockers(): Answer {
  const open = getInboxBlockers();
  const sent = getSentBlockers();
  const total = open.length + sent.length;

  if (total === 0) {
    return { speech: 'Nothing is blocked right now.', detail: [], tone: 'ok', href: '/', unanswered: false };
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
      href: '/',
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
