import { isSeeded } from '@/lib/db/queries';
import { getCurrentUser } from '@/lib/demo/session';
import { buildBriefing } from '@/lib/chief/briefing';
import { SeedPrompt } from '@/components/SeedPrompt';
import { ChiefPanel } from '@/components/chief/ChiefPanel';

export const dynamic = 'force-dynamic';

/**
 * The chief-of-staff surface: the briefing is composed on the server from the
 * same queries the dashboard uses, so the spoken version and the visual one
 * can never disagree.
 */
export default async function ChiefPage() {
  if (!isSeeded()) return <SeedPrompt />;

  const user = await getCurrentUser();
  const briefing = buildBriefing(user);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Daily Brief</h1>
        <p className="mt-1 text-sm text-ink-500">
          Press <strong className="font-semibold text-ink-700">Brief me</strong> and it reads the state of the
          workspace aloud, then answers questions about it. Everything it says comes from records you can open.
        </p>
      </header>

      {/* Keyed on the identity: switching who you are viewing as rebuilds the
          panel with that person's briefing, rather than leaving the previous
          one in client state. */}
      <ChiefPanel key={user?.id ?? 'none'} initialBriefing={briefing} />
    </div>
  );
}
