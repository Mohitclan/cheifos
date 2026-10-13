import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Activity,
  CalendarRange,
  LayoutDashboard,
  MessageSquareWarning,
  PenLine,
  ShieldAlert,
  Speech,
} from 'lucide-react';
import { providerStatus } from '@/lib/ai/provider';
import { getUsers } from '@/lib/db/queries';
import { getCurrentUser } from '@/lib/demo/session';
import { IdentitySwitcher } from './IdentitySwitcher';
import { ResetButton } from './ResetButton';

/**
 * The frame every surface renders inside.
 *
 * Three things are permanently visible here, by design:
 *   - DEMO MODE, so nobody can mistake fictional data for company data.
 *   - The provider chip, which states what is doing the extraction. Nobody can
 *     later claim the demo implied a language model was running.
 *   - The production-auth warning, because role switching is not security and
 *     saying so on screen reads as maturity rather than as a gap.
 */

const NAV = [
  { href: '/chief', label: 'Daily Brief', icon: Speech, role: 'CEO' },
  { href: '/', label: 'Command Center', icon: LayoutDashboard, role: 'CEO' },
  { href: '/decisions', label: 'Decision Inbox', icon: MessageSquareWarning, role: 'CEO' },
  { href: '/schedule', label: 'Schedule', icon: CalendarRange, role: 'CEO' },
  { href: '/employee', label: 'Employee Workspace', icon: PenLine, role: 'Team' },
  { href: '/activity', label: 'Activity', icon: Activity, role: 'Audit' },
] as const;

export async function AppShell({ children }: { children: ReactNode }) {
  const users = getUsers();
  const current = await getCurrentUser();
  const provider = providerStatus();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-navy-900 lg:flex">
        <div className="px-5 py-5">
          <Link href="/" className="block">
            <span className="text-base font-semibold tracking-tight text-white">ChiefOS</span>
            <span className="mt-0.5 block text-[11px] text-navy-300">AI Chief of Staff</span>
          </Link>
        </div>

        <nav className="flex-1 px-3">
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-navy-200 transition-colors hover:bg-navy-800 hover:text-white"
                >
                  <item.icon size={16} className="shrink-0 text-navy-300 group-hover:text-accent-500" aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  <span className="text-[10px] font-semibold tracking-wider text-navy-300/70 uppercase">
                    {item.role}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-navy-800 px-4 py-4">
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-navy-300">
            <ShieldAlert size={14} className="mt-0.5 shrink-0 text-risk-500" aria-hidden />
            <span>
              Nothing in this system sends a message or closes a blocker without a human pressing approve.
            </span>
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-navy-800 bg-navy-900">
          <div className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-risk-500 px-2.5 py-1 text-[11px] font-bold tracking-wider text-navy-950 uppercase">
              Demo mode - fictional data
            </span>

            <span
              className="inline-flex items-center gap-2 rounded-full border border-navy-700 px-2.5 py-1 text-[11px] font-medium text-navy-200"
              title="Extraction runs locally with a deterministic rules engine. No model is connected."
            >
              <span className="text-navy-300">Extraction:</span>
              <span className="font-semibold text-white">{provider.extraction}</span>
              <span aria-hidden className="text-navy-700">
                |
              </span>
              <span className="text-navy-300">Internal LLM:</span>
              <span
                className={`font-semibold ${provider.llmConnected ? 'text-accent-500' : 'text-risk-500'}`}
              >
                {provider.llm}
              </span>
            </span>

            <div className="ml-auto flex items-center gap-3">
              <IdentitySwitcher users={users} currentId={current?.id ?? null} />
              <ResetButton />
            </div>
          </div>

          {/* The sidebar is hidden below lg, so navigation moves here rather
              than disappearing on a narrow window. */}
          <nav className="flex gap-1 overflow-x-auto border-t border-navy-800 px-4 py-2 lg:hidden">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-navy-200 transition-colors hover:bg-navy-800 hover:text-white"
              >
                <item.icon size={14} className="text-navy-300" aria-hidden />
                {item.label}
              </Link>
            ))}
          </nav>

          <p className="border-t border-navy-800 bg-navy-950 px-5 py-1.5 text-[11px] text-navy-300">
            <strong className="font-semibold text-navy-200">Not authenticated.</strong> Identity switching here is a
            demo control, not security. Production requires server-enforced authentication, authorisation and
            organisation scoping before any real record enters the system.
          </p>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-6">{children}</main>

        <footer className="border-t border-line px-5 py-4 text-[11px] text-ink-400">
          ChiefOS prototype - runs locally, no paid services, no network calls. All people, projects and updates
          shown are fictional.
        </footer>
      </div>
    </div>
  );
}
