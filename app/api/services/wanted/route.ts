import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { withinLimits, callerAddress, GLOBAL_KEY } from '@/lib/rateLimit';
import { announceWanted } from '@/lib/serviceEnquiryAlert';
import { canBeEnquiredAbout, tradeLabel } from '@/lib/serviceProviders';

export const dynamic = 'force-dynamic';

// A host telling us what they looked for and did not find.
//
// The shop opens with an empty directory — tradesmen are being signed up by
// hand — so the commonest first experience is finding nobody. This is what
// that screen offers instead of a dead end, and the answer is the most useful
// thing the feature produces: "three hosts wanted a roofer in Wigtown" is a
// recruiting list rather than a complaint.
//
// SIGNING IN IS NOT REQUIRED. The person browsing before they have an account
// is exactly whose interest is worth knowing, and making them sign in to say
// "I need a roofer" trades the signal for an identity. If there is a session
// the row carries it; if not, it does not.
export async function POST(req: Request) {
    try {
        const body = await req.json();

        const trade = String(body.trade || '').trim();
        if (!trade || !canBeEnquiredAbout(trade)) {
            return NextResponse.json({ ok: false, error: 'Pick a trade.' }, { status: 400 });
        }

        // Optional, and that is the point — it is one press with nothing typed.
        const note = String(body.note || '').trim().slice(0, 1000);
        const contact = String(body.contact || '').trim().slice(0, 200);
        const area = String(body.area_key || '').trim().slice(0, 120);

        const supabase = createRouteHandlerClient({ cookies });
        const { data: auth } = await supabase.auth.getUser();
        const hostId = auth && auth.user ? auth.user.id : null;

        // HOW OFTEN A STRANGER MAY DO THIS.
        //
        // Open on purpose — a host telling us they cannot find a plumber
        // should not have to be signed in to say so. But every call writes a
        // row AND emails an alert with text the caller chose, which is a spam
        // relay pointed at your own inbox. Once that inbox stops being read,
        // the real ones stop being read with it.
        //
        // A signed-in host is counted by their own id rather than their
        // address, so a household or an office behind one connection does not
        // throttle each other.
        const verdict = await withinLimits([
            { bucket: 'services-wanted:all', key: GLOBAL_KEY, max: 40, windowMinutes: 60 },
            {
                bucket: hostId ? 'services-wanted:user' : 'services-wanted:ip',
                key: hostId || callerAddress(req.headers),
                max: 5,
                windowMinutes: 60,
            },
        ]);

        if (!verdict.ok) {
            await logError(
                verdict.hit && verdict.hit.startsWith('services-wanted:all')
                    ? '[services/wanted] the site-wide limit was hit — somebody may be aiming at '
                        + 'the alert inbox'
                    : '[services/wanted] a request was rate limited',
                { limit: verdict.hit, trade, area, hostId },
                { path: 'services/wanted' }
            );
            return NextResponse.json({
                ok: false,
                error: 'We have had a lot of these just now. Please try again in an hour.',
            }, { status: 429 });
        }

        const admin = adminClient();

        const { data: saved, error } = await admin
            .from('service_wanted')
            .insert({
                host_id: hostId,
                trade,
                area_key: area,
                note,
                contact: contact || (auth && auth.user ? String(auth.user.email || '') : ''),
            })
            .select('*')
            .single();

        if (error || !saved) {
            await logError('service-wanted', { trade, area, error: String(error && error.message) });
            return NextResponse.json({ ok: false, error: 'Could not send that.' }, { status: 500 });
        }

        // The row is the record; the email is what makes somebody act on it.
        // A failed send must not lose the row, so it is not awaited into the
        // response's success.
        try {
            await announceWanted(saved, tradeLabel(trade));
        } catch (err: any) {
            await logError('service-wanted-email', { id: String(saved.id), error: String(err && err.message) });
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        await logError('service-wanted', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
