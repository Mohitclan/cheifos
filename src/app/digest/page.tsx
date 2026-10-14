import { requireCeo } from '@/lib/auth/guard';
import { isSeeded } from '@/lib/db/queries';
import { buildDigest } from '@/lib/mail/digest';
import { appUrl, mailStatus } from '@/lib/mail/provider';
import { Panel } from '@/components/ui';
import { SeedPrompt } from '@/components/SeedPrompt';
import { SendDigest } from '@/components/mail/SendDigest';

export const dynamic = 'force-dynamic';

export default async function DigestPage() {
  const user = await requireCeo();
  if (!isSeeded()) return <SeedPrompt />;

  const mail = buildDigest(user, user.name, appUrl());
  const status = mailStatus();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Daily digest</h1>
        <p className="mt-1 text-sm text-ink-500">
          The morning email, exactly as it would arrive. Built from the same records as the Command
          Center, so it cannot say anything the app would not.
        </p>
      </header>

      <div
        className={`rounded-xl border px-5 py-4 text-sm ${
          status.configured ? 'border-ok-500/40 bg-ok-100 text-ok-700' : 'border-line bg-panel text-ink-600'
        }`}
      >
        <p className="font-medium">
          {status.configured
            ? `Mail provider: ${status.label}. Sending is live.`
            : 'No mail provider configured, so nothing can be sent yet.'}
        </p>
        {!status.configured && (
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            Set <code className="rounded bg-white px-1">CHIEFOS_MAIL_PROVIDER</code>,{' '}
            <code className="rounded bg-white px-1">CHIEFOS_MAIL_API_KEY</code> and{' '}
            <code className="rounded bg-white px-1">CHIEFOS_MAIL_FROM</code> in{' '}
            <code className="rounded bg-white px-1">.env.local</code>. Resend and Brevo both have free
            tiers that cover one digest a day many times over. Verify your sending domain first - without
            SPF and DKIM the digest lands in spam, which is worse than not sending it.
          </p>
        )}
      </div>

      <Panel title="Subject line" bodyClassName="px-5 py-4">
        <p className="text-sm font-medium text-ink-900">{mail.subject}</p>
      </Panel>

      <Panel
        title="Preview"
        subtitle="Rendered in an isolated frame, the way a mail client would show it."
        bodyClassName="p-0"
      >
        <iframe
          title="Daily digest preview"
          srcDoc={mail.html}
          sandbox=""
          className="h-[640px] w-full rounded-b-xl border-0 bg-surface"
        />
      </Panel>

      <Panel
        title="Plain text version"
        subtitle="Always sent alongside the HTML. Some clients and most watches show this one."
        bodyClassName="px-5 py-4"
      >
        <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-600">{mail.text}</pre>
      </Panel>

      <SendDigest configured={status.configured} />

      <p className="text-xs leading-relaxed text-ink-400">
        This page composes and previews only. A digest that arrives at 8am without anyone opening the
        app needs this hosted somewhere with a scheduler running server-side - the email itself is the
        small part.
      </p>
    </div>
  );
}
