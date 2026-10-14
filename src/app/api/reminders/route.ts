import { NextResponse } from 'next/server';
import { expireMissedReminders, ownerAddress, runReminders, LEAD_MINUTES } from '@/lib/mail/reminders';

export const dynamic = 'force-dynamic';

/**
 * The endpoint a timer calls. One pass per call, idempotent per block.
 *
 * Protected by a shared secret rather than a session, because the caller is a
 * cron job and not a person. Without CHIEFOS_CRON_SECRET set, the route
 * refuses to run at all - an unauthenticated endpoint that sends email on
 * someone's behalf is not something to leave open by default.
 *
 * Call it as often as you like; every ten minutes is sensible for a two hour
 * lead time.
 *
 *   curl -H "Authorization: Bearer $CHIEFOS_CRON_SECRET" \
 *        http://localhost:3000/api/reminders
 */
export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CHIEFOS_CRON_SECRET ?? '';

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CHIEFOS_CRON_SECRET is not set, so this endpoint is disabled.' },
      { status: 503 },
    );
  }

  const provided = request.headers.get('authorization') ?? '';
  if (provided !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const expired = expireMissedReminders();
  const result = await runReminders(ownerAddress);

  return NextResponse.json({
    ok: result.errors.length === 0,
    leadMinutes: LEAD_MINUTES,
    ...result,
    expired,
    ranAt: new Date().toISOString(),
  });
}
