import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Activity,
  CalendarRange,
  ClipboardCheck,
  LayoutDashboard,
  MessageSquareWarning,
  PenLine,
  ShieldAlert,
  Speech,
} from 'lucide-react';
import { providerStatus } from '@/lib/ai/provider';
import { currentUser } from '@/lib/auth/guard';
import { SignedInAs } from './SignedInAs';
import { ResetButton } from './ResetButton';

/**
 * The frame every surface renders inside.
 *
 * Three things are permanently visible here, by design:
 *   - DEMO MODE, so nobody can mistake fictional data for company data.
 *   - The provider chip, which states what is doing the extraction. Nobody can
 *     later claim the demo implied a language model was running.
 *   - Who you are signed in as, and the way out.
 */

/**
/**
 * Navigation per role.
 *
 * This is a convenience, not a control: every page guards itself on the
 * server, so hiding a link here is only about not showing someone a door they
 * cannot open.
 */
const CEO_NAV = [
  { href: '/chief', label: 'Daily Brief', icon: Speech },
  { href: '/', label: 'Command Center', icon: LayoutDashboard },
  { href: '/decisions', label: 'Decision Inbox', icon: MessageSquareWarning },
  { href: '/schedule', label: 'Schedule', icon: CalendarRange },
  { href: '/reporting', label: 'Update reporting', icon: ClipboardCheck },
  { href: '/activity', label: 'Activity', icon: Activity },
] as const;

const EMPLOYEE_NAV = [
  { href: '/employee', label: 'My Workspace', icon: PenLine },
] as const;

export async function AppShell({ children }: { children: ReactNode }) {
  const current = await currentUser();

  // Signed out: the login screen brings its own layout. Rendering the shell
  // around it would show navigation to someone who cannot use any of it.
  if (!current) return <>{children}</>;

  const provider = providerStatus();
  const NAV = current.role === 'ceo' ? CEO_NAV : EMPLOYEE_NAV;

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
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-2.5 border-t border-navy-800 px-4 py-4">
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-navy-200">
            <ShieldAlert size={14} className="mt-0.5 shrink-0 text-risk-500" aria-hidden />
            <span>
              Nothing in this system sends a message or closes a blocker without a human pressing approve.
            </span>
          </p>
          <p className="pl-[22px] text-[10px] leading-relaxed text-navy-400">
            Sessions are signed and every page and action checks your role on the server.
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-navy-800 bg-navy-900">
          {/* One strip, not three. Demo status, what is doing the extraction,
              and who you are reading as - each stated once, quietly. The full
              wording of each caveat lives in a title so nothing is lost. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
            <span className="inline-flex items-center gap-2 text-[12px] font-medium text-risk-500">
              <span className="h-1.5 w-1.5 rounded-full bg-risk-500" aria-hidden />
              Demo data
            </span>

            <span
              className="text-[12px] text-navy-300"
              title="Extraction runs locally with a deterministic rules engine. No language model is connected."
            >
              {provider.extraction}
              <span aria-hidden className="mx-1.5 text-navy-700">
                ·
              </span>
              <span className={provider.llmConnected ? 'text-accent-500' : 'text-navy-400'}>
                model {provider.llm}
              </span>
            </span>

            <div className="ml-auto flex items-center gap-3">
              <SignedInAs name={current.name} role={current.role} />
              {current.role === 'ceo' && <ResetButton />}
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
