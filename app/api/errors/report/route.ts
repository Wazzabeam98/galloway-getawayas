import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { withinLimits, callerAddress, GLOBAL_KEY } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Called by the error pages when something breaks in a browser.
//
// Deliberately open — an error can happen to someone who isn't signed in, and
// those are exactly the ones worth knowing about. It writes to a table nobody
// but an owner can read, and the fields are capped so a flood of junk can't
// fill the database.
export async function POST(req: NextRequest) {
    try {
        // HOW OFTEN A STRANGER MAY FILL THE ERROR LOG.
        //
        // This is open on purpose and should stay open: an error can happen to
        // somebody who is not signed in, and those are the ones most worth
        // knowing about. But it writes a row on every call, and the table it
        // writes to is /admin/errors — the page relied on to notice everything
        // else on this site. Flooding it does not just add junk; it buries the
        // one real failure among ten thousand invented ones, which is a better
        // attack than deleting the table would be.
        //
        // The site-wide cap is the half that matters, for the same reason as
        // services/apply: the caller picks their own address. 300 an hour is
        // far more than a genuinely broken deploy produces, and a small
        // fraction of what a script does in a minute.
        //
        // NOT REPORTED WHEN IT TRIPS. Everywhere else a refusal goes to
        // logError. Doing that here would write a row to the very table being
        // protected, on every refused request — the flood, with extra steps.
        const verdict = await withinLimits([
            { bucket: 'errors-report:all', key: GLOBAL_KEY, max: 300, windowMinutes: 60 },
            { bucket: 'errors-report:ip', key: callerAddress(req.headers), max: 30, windowMinutes: 60 },
        ]);

        if (!verdict.ok) {
            // 200, not 429. This is called from an error page by code that has
            // already failed once; the browser does nothing with the answer,
            // and an error handler that itself errors is how a broken page
            // becomes a broken page that also spins.
            return NextResponse.json({ ok: false, throttled: true });
        }

        const body = await req.json();

        const message = String((body && body.message) || 'Unknown error').slice(0, 500);
        const detail = body && body.detail ? String(body.detail).slice(0, 4000) : null;
        const path = body && body.path ? String(body.path).slice(0, 500) : null;
        const digest = body && body.digest ? String(body.digest).slice(0, 100) : null;

        // Who it happened to, if they were signed in. Helps enormously when
        // someone reports a problem and you're trying to find their error.
        let userId: string | null = null;
        try {
            const supabase = createRouteHandlerClient({ cookies });
            // getUser(), not getSession(). getSession() only decodes the auth
            // cookie — it never checks the signature — so the id below would be
            // whatever the caller wrote in it. getUser() asks the auth server,
            // which verifies the token and that the session has not been revoked.
            const { data: { user } } = await supabase.auth.getUser();
            userId = (user && user.id) || null;
        } catch {
            // Not signed in, or no session. Still worth recording.
        }

        const admin = adminClient();

        await admin.from('error_log').insert({
            source: 'client',
            message: message,
            detail: detail,
            path: path,
            digest: digest,
            user_id: userId,
            user_agent: (req.headers.get('user-agent') || '').slice(0, 300),
        });

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        // Never let the error reporter become another error the guest sees.
        console.error('[errors/report]', err && err.message);
        return NextResponse.json({ ok: false });
    }
}
