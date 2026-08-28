import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { announceExpiry } from '@/lib/serviceEnquiryAlert';
import { settleDue } from '@/lib/serviceEnquirySweep';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Telling a host that nobody answered.
//
// WHY THIS IS THE MOST IMPORTANT ROUTE IN THE WHOLE FLOW
//
// One enquiry goes to one tradesman and nothing fans out. That makes silence
// the likeliest way this fails — not a dispute, not a double booking, silence
// — and a host staring at "Sent" for a fortnight is a host who concludes the
// site does nothing. This is the route that stops that happening.
//
// It matters more now than it did. There is no longer any second ending: an
// unanswered emergency used to release the tradesman's number, and does not,
// so this email is the ONLY thing a host gets when nobody replies. If it does
// not go out they are simply left.
//
// WHY EVERY FIVE MINUTES
//
// It was hourly, which was fine when the shortest deadline was 48 hours. An
// emergency runs out in twenty minutes, and an hourly sweep would leave a host
// waiting three times that before being told to ring somebody else — on the
// one case where minutes are the whole point.
//
// The host's own screen settles their own rows exactly, on load, so the
// visible lag is nothing; this is what sends the email, and what covers a host
// who is not looking at the page.
//
// The writing is in lib/serviceEnquirySweep.ts, shared with that route.
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');

    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    const settled = await settleDue();

    let told = 0;

    for (const enquiry of settled.expired) {
        try {
            let listing: any = null;
            if (enquiry.listing_id) {
                const { data } = await admin
                    .from('listings')
                    .select('id, title, location')
                    .eq('id', enquiry.listing_id)
                    .maybeSingle();
                listing = data;
            }

            const result = await announceExpiry(enquiry, listing);
            if (result.host) told++;
        } catch (err: any) {
            // One host's email failing must not stop the sweep for everybody
            // behind them in the list.
            await logError('service-enquiry-expiry', {
                enquiry: String(enquiry.id),
                error: String(err && err.message),
            });
        }
    }

    return NextResponse.json({ ok: true, expired: settled.expired.length, told });
}
