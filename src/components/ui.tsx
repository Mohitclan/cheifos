import type { ReactNode } from 'react';

/**
 * The handful of presentational primitives the whole app is built from.
 *
 * Hand-written rather than generated: the surface area needed here is small
 * (panel, pill, button, field, empty state), the markup is owned in-repo
 * either way, and keeping it in one file means the visual pass is one file to
 * edit rather than a dozen.
 */

type Tone = 'neutral' | 'accent' | 'blocked' | 'risk' | 'ok' | 'done';

const PILL_TONES: Record<Tone, string> = {
  neutral: 'bg-done-100 text-done-700',
  accent: 'bg-accent-100 text-accent-700',
  blocked: 'bg-blocked-100 text-blocked-700',
  risk: 'bg-risk-100 text-risk-700',
  ok: 'bg-ok-100 text-ok-700',
  done: 'bg-done-100 text-done-700',
};

export function Pill({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ${PILL_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Project and task status, mapped once so the scale cannot drift. */
export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: Tone }> = {
    on_track: { label: 'On track', tone: 'ok' },
    at_risk: { label: 'At risk', tone: 'risk' },
    blocked: { label: 'Blocked', tone: 'blocked' },
    done: { label: 'Done', tone: 'done' },
    todo: { label: 'To do', tone: 'neutral' },
    in_progress: { label: 'In progress', tone: 'accent' },
    open: { label: 'Open', tone: 'blocked' },
    awaiting_decision: { label: 'Awaiting decision', tone: 'risk' },
    decision_sent: { label: 'Decision sent', tone: 'accent' },
    resolved: { label: 'Resolved', tone: 'ok' },
    draft: { label: 'Draft', tone: 'neutral' },
    sent: { label: 'Sent', tone: 'accent' },
    approved: { label: 'Approved', tone: 'ok' },
    proposed: { label: 'Proposed', tone: 'risk' },
    clarification_requested: { label: 'Clarification requested', tone: 'risk' },
  };
  const entry = map[status] ?? { label: status.replace(/_/g, ' '), tone: 'neutral' as Tone };
  return <Pill tone={entry.tone}>{entry.label}</Pill>;
}

/**
 * Only high priority earns a badge.
 *
 * When every row carries a priority chip, the chips stop meaning anything and
 * just add visual weight. Medium and low read as plain text, so the eye lands
 * on what actually needs the CEO.
 */
export function PriorityPill({ priority }: { priority: 'high' | 'medium' | 'low' }) {
  if (priority !== 'high') {
    return <span className="text-[11px] text-ink-400 capitalize">{priority}</span>;
  }
  return <Pill tone="blocked">High priority</Pill>;
}

/** Marks a value the system inferred rather than read. Never hidden. */
export function AssumptionTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-risk-500/40 bg-risk-100 px-1.5 py-0.5 text-[10px] font-medium text-risk-700">
      {children}
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_2px_rgba(18,23,34,0.04)] ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={bodyClassName || 'px-5 py-4'}>{children}</div>
    </section>
  );
}

export function KpiCard({
  label,
  value,
  note,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  note?: string;
  tone?: Tone;
}) {
  const accentBar: Record<Tone, string> = {
    neutral: 'bg-line-strong',
    accent: 'bg-accent-500',
    blocked: 'bg-blocked-500',
    risk: 'bg-risk-500',
    ok: 'bg-ok-500',
    done: 'bg-done-700',
  };
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-panel px-5 py-4 shadow-[0_1px_2px_rgba(18,23,34,0.04)]">
      <span className={`absolute inset-y-0 left-0 w-1 ${accentBar[tone]}`} aria-hidden />
      <p className="text-[11px] font-semibold text-ink-400">{label}</p>
      <p className="numeric mt-2 text-3xl leading-none font-semibold text-ink-900">{value}</p>
      {note && <p className="mt-2 text-xs leading-snug text-ink-500">{note}</p>}
    </div>
  );
}

const BUTTON_VARIANTS = {
  primary: 'bg-accent-600 text-white hover:bg-accent-700 disabled:bg-accent-600/50',
  secondary: 'bg-panel text-ink-700 border border-line-strong hover:bg-surface disabled:text-ink-400',
  quiet: 'text-ink-500 hover:text-ink-900 hover:bg-surface',
  danger: 'bg-blocked-500 text-white hover:bg-blocked-700 disabled:bg-blocked-500/50',
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function buttonClass(variant: ButtonVariant = 'primary', extra = ''): string {
  return `inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${extra}`;
}

export function Field({
  label,
  hint,
  children,
  tag,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  tag?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-ink-400">
        {label}
        {tag}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-line-strong bg-panel px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400';

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface px-5 py-8 text-center">
      <p className="text-sm font-semibold text-ink-700">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-500">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Inline result of an action. Never a stack trace, always a next step. */
export function Notice({
  tone,
  children,
  detail,
}: {
  tone: 'ok' | 'error' | 'info';
  children: ReactNode;
  detail?: string | null;
}) {
  const styles = {
    ok: 'border-ok-500/40 bg-ok-100 text-ok-700',
    error: 'border-blocked-500/40 bg-blocked-100 text-blocked-700',
    info: 'border-accent-500/40 bg-accent-100 text-accent-700',
  } as const;
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${styles[tone]}`} role="status">
      {children}
      {detail && <span className="mt-1 block font-mono text-[11px] opacity-80">{detail}</span>}
    </div>
  );
}

/** The original wording of an update, always shown beside generated fields. */
export function Transcript({ text, label = 'Original wording, as submitted' }: { text: string; label?: string }) {
  return (
    <figure className="rounded-lg border border-line bg-surface px-4 py-3">
      <figcaption className="mb-2 text-[11px] font-semibold text-ink-400">
        {label}
      </figcaption>
      <blockquote className="transcript text-ink-700">{text}</blockquote>
    </figure>
  );
}
