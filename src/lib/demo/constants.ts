/**
 * Fixed identities the demo script depends on. Seed and UI both read these so
 * a rename cannot desynchronise them.
 *
 * All of this is fictional. There is no real company data anywhere in ChiefOS.
 */
export const DEMO = {
  ceoName: 'Rohan Mehta',
  employeeName: 'Aanya Sharma',
  projectName: 'Subscription Dashboard',
  dependencyDepartment: 'Finance',
} as const;

export const DEPARTMENTS = [
  'Product Engineering',
  'Finance',
  'Design',
  'Data',
  'Legal',
] as const;

/** The working day the schedule planner places blocks inside. */
export const WORKDAY = { startHour: 9, endHour: 18 } as const;

/** Used where a duration is not stated. Always marked as an assumption. */
export const DEFAULT_BLOCK_MINUTES = 60;

/**
 * Sample transcripts, loaded by a button beside the microphone.
 *
 * This button is what gets clicked on stage. Voice capture is Chrome-only and
 * degrades in a room with people talking, so it is never the dependency - the
 * sample is. The second sample is deliberately vague: it is what triggers the
 * clarification question.
 */
export const DEMO_SAMPLES = [
  {
    label: 'Blocked on Finance (scripted)',
    text:
      "The dashboard API integration is about 70% done. I'm blocked because I still need Finance to " +
      'confirm the subscription status fields. I need a decision today to finish the integration.',
  },
  {
    label: 'Deliberately vague',
    text: 'Still stuck on the same thing as last week.',
  },
  {
    label: 'Done, nothing blocked',
    text: 'Shipped the auth refactor, no issues.',
  },
] as const;

/** The day request the schedule demo uses. It contains a genuine overlap. */
export const DEMO_SCHEDULE_REQUEST =
  'Review the subscription dashboard blocker first thing, sync with Finance at 11 for an hour, ' +
  'pricing launch review at 11:30, interview the platform candidate after lunch for 45 minutes, ' +
  'and keep some time for urgent issues';
