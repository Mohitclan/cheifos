import { getComplianceWindow, getReportingStatus, type ReportingRow } from '@/lib/db/queries';
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

/**
 * The filing report.
 *
 * Two different questions, answered side by side: how consistently has someone
 * filed over a window, and how long has it been since they last did. A person
 * can look fine on one and bad on the other - filing every day then stopping
 * three days ago is a different problem from filing twice a fortnight - and
 * collapsing them into a single score would hide both.
 */

export interface ComplianceEntry extends ReportingGap {
  daysFiled: number;
  expectedDays: number;
  /** Share of working days in the window with an update. 0 to 1. */
  rate: number;
  filedToday: boolean;
}

export interface ComplianceReport {
  fromDate: string;
  toDate: string;
  /** Working days in the window, which is what people are measured against. */
  expectedDays: number;
  entries: ComplianceEntry[];
  filedToday: number;
  teamSize: number;
  /** Mean filing rate across the team, 0 to 1. */
  teamRate: number;
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/** Working days in [from, to] inclusive of both ends. */
export function workingDaysInclusive(from: string, to: string): number {
  const first = new Date(`${from}T00:00:00`);
  return (isWeekendDate(first) ? 0 : 1) + workingDaysBetween(from, to);
}

function isWeekendDate(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function buildComplianceReport(windowDays = 14, asOf: string = todayIso()): ComplianceReport {
  const fromDate = shiftDays(asOf, -(windowDays - 1));
  const expectedDays = workingDaysInclusive(fromDate, asOf);

  const windowRows = getComplianceWindow(fromDate, asOf);
  const gaps = new Map(getReportingGaps(asOf).map((gap) => [gap.id, gap]));

  const entries: ComplianceEntry[] = windowRows.map((row) => {
    // The gap carries the true last-filed date; the window row only knows
    // about updates inside the window.
    const gap = gaps.get(row.id)!;
    const daysFiled = Number(row.days_filed ?? 0);

    return {
      ...gap,
      daysFiled,
      expectedDays,
      rate: expectedDays > 0 ? Math.min(1, daysFiled / expectedDays) : 0,
      filedToday: gap.last_update_date === asOf,
    };
  });

  entries.sort((a, b) => a.rate - b.rate || b.missedWorkingDays - a.missedWorkingDays);

  const filedToday = entries.filter((entry) => entry.filedToday).length;
  const teamRate = entries.length
    ? entries.reduce((sum, entry) => sum + entry.rate, 0) / entries.length
    : 0;

  return {
    fromDate,
    toDate: asOf,
    expectedDays,
    entries,
    filedToday,
    teamSize: entries.length,
    teamRate,
  };
}

/** Spreadsheet-ready. The CEO who asks for this will want to forward it. */
export function complianceCsv(report: ComplianceReport): string {
  const header = [
    'Name', 'Title', 'Department', 'Filed today', 'Days filed', 'Working days',
    'Filing rate %', 'Last filed', 'Working days since', 'Status',
  ];

  const rows = report.entries.map((entry) => [
    entry.name,
    entry.title ?? '',
    entry.department_name ?? '',
    entry.filedToday ? 'Yes' : 'No',
    String(entry.daysFiled),
    String(entry.expectedDays),
    String(Math.round(entry.rate * 100)),
    entry.last_update_date ?? 'Never',
    entry.neverReported ? '' : String(entry.missedWorkingDays),
    entry.severity,
  ]);

  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
