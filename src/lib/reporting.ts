import { getReportingStatus, type ReportingRow } from '@/lib/db/queries';
import { isoDate, todayIso } from '@/lib/format';

/**
 * Who has stopped filing updates.
 *
 * Everything else in ChiefOS is built from what people reported. This is the
 * one view built from what they did not: silence is a signal, and a dashboard
 * that cannot show it has a blind spot exactly where the risk usually is.
 *
 * Counted in working days, because a Monday gap after a weekend is not three
 * days of silence and reporting it as such would train people to ignore this.
 */

export interface ReportingGap extends ReportingRow {
  /** Working days between their last update and today. 0 = filed today. */
  missedWorkingDays: number;
  /** Never submitted anything at all. */
  neverReported: boolean;
  severity: 'ok' | 'watch' | 'overdue';
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** Working days strictly after `from` up to and including `to`. */
export function workingDaysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  let count = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);

  while (cursor <= end) {
    if (!isWeekend(cursor)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export function getReportingGaps(asOf: string = todayIso()): ReportingGap[] {
  return getReportingStatus().map((row) => {
    const neverReported = !row.last_update_date;
    const missedWorkingDays = neverReported ? Infinity : workingDaysBetween(row.last_update_date!, asOf);

    let severity: ReportingGap['severity'] = 'ok';
    if (neverReported || missedWorkingDays >= 3) severity = 'overdue';
    else if (missedWorkingDays >= 1) severity = 'watch';

    return { ...row, missedWorkingDays, neverReported, severity };
  });
}

/** Everyone who has not filed today, worst first. */
export function getMissingToday(asOf: string = todayIso()): ReportingGap[] {
  return getReportingGaps(asOf)
    .filter((row) => row.missedWorkingDays > 0)
    .sort((a, b) => b.missedWorkingDays - a.missedWorkingDays);
}

/** Plain wording for the interface and for the assistant to read aloud. */
export function gapLabel(gap: ReportingGap): string {
  if (gap.neverReported) return 'has never filed an update';
  if (gap.missedWorkingDays === 0) return 'filed today';
  if (gap.missedWorkingDays === 1) return 'last filed yesterday';
  return `last filed ${gap.missedWorkingDays} working days ago`;
}

/** Today, as the reporting view counts it. Weekends have nothing expected. */
export function isReportingDay(date: string = todayIso()): boolean {
  return !isWeekend(new Date(`${date}T00:00:00`));
}

export { isoDate };
