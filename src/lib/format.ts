import { differenceInCalendarDays, format, formatDistanceToNowStrict, isValid } from 'date-fns';

/** Display helpers. Nothing here changes stored values. */

export function day(value: string | null | undefined): string {
  if (!value) return '--';
  const date = new Date(value);
  return isValid(date) ? format(date, 'd MMM yyyy') : '--';
}

export function dayShort(value: string | null | undefined): string {
  if (!value) return '--';
  const date = new Date(value);
  return isValid(date) ? format(date, 'EEE d MMM') : '--';
}

export function clock(value: string): string {
  const date = new Date(value);
  return isValid(date) ? format(date, 'HH:mm') : '--:--';
}

export function timestamp(value: string): string {
  const date = new Date(value);
  return isValid(date) ? format(date, 'd MMM, HH:mm') : '--';
}

export function ago(value: string): string {
  const date = new Date(value);
  return isValid(date) ? `${formatDistanceToNowStrict(date)} ago` : '';
}

/** ISO date (YYYY-MM-DD) in local time, which is what plan_date stores. */
export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function todayIso(): string {
  return isoDate(new Date());
}

export function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDate(d);
}

/**
 * Due-soon wording, computed on render. This replaced reminders and browser
 * notifications deliberately: a badge that is always correct beats a
 * notification that may silently never fire.
 */
export function dueLabel(value: string | null): { text: string; tone: 'blocked' | 'risk' | 'neutral' } | null {
  if (!value) return null;
  const date = new Date(value);
  if (!isValid(date)) return null;

  const days = differenceInCalendarDays(date, new Date());
  if (days < 0) return { text: `Overdue by ${Math.abs(days)}d`, tone: 'blocked' };
  if (days === 0) return { text: 'Due today', tone: 'blocked' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'risk' };
  if (days <= 3) return { text: `Due in ${days}d`, tone: 'risk' };
  return { text: `Due ${format(date, 'd MMM')}`, tone: 'neutral' };
}

export function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    project: 'Project',
    task: 'Task',
    progress_percent: 'Progress',
    status: 'Status',
    blocker: 'Blocker',
    dependency_department: 'Waiting on',
    help_needed: 'Help needed',
    deadline_text: 'Stated timing',
    risk: 'Risk',
  };
  return labels[key] ?? key.replace(/_/g, ' ');
}
