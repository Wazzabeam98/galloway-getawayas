import { NextResponse } from 'next/server';
import { logError, logInfo } from '@/lib/logError';
import { lostSignInIsExpected } from '@/lib/staySignedIn';

export const dynamic = 'force-dynamic';

// Where the middleware reports a sign-in that ended without the person ending
// it (lib/staySignedIn, "noticing a lost sign-in"). Written to the error log,
// so the morning digest counts them under one heading per kind:
//
//   cookie_gone      the device came back with no sign-in cookie at all — the
//                    browser dropped it (the Safari pattern seen on 3 Oct 2026:
//                    sessions alive on Supabase, never refreshed, the phone
//                    asking for a code an hour later).
//   session_refused  the cookie came back and Supabase refused it (revoked,
//                    signed out everywhere from another device, deactivated).
//
// minutesSinceSeen says which kind of loss it was: about an hour points at the
// first token refresh, about a week at Safari's cap on script-written cookies.
// A cookie_gone after EXPECTED_COOKIE_LOSS_MINUTES (12 hours) is the normal
// end of a sign-in, so it is recorded as information and stays out of the
// error list; a sooner one, and every session_refused, is still an error.
// Called only by the middleware, which signs the request with CRON_SECRET.
export async function POST(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get('x-gg-internal') !== secret) {
        return NextResponse.json({ ok: false }, { status: 401 });
    }
    const body = await request.json().catch(() => null);
    const kind = body && (body.kind === 'cookie_gone' || body.kind === 'session_refused') ? body.kind : null;
    if (!kind) return NextResponse.json({ ok: false }, { status: 400 });

    const record = lostSignInIsExpected(kind, body.minutesSinceSeen) ? logInfo : logError;
    await record('sign-in lost: ' + kind, {
        session: String(body.session || '').slice(0, 8),
        lastSeenAt: body.lastSeenAt,
        minutesSinceSeen: body.minutesSinceSeen,
        path: body.path,
        userAgent: body.userAgent,
        refusal: body.refusal,
    }, { path: '/api/auth/lost' });

    return new NextResponse(null, { status: 204 });
}
