import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { announceSilence } from '@/lib/serviceEnquiryAlert';
import { settleDue } from '@/lib/serviceEnquirySweep';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Telling people that nobody answered.
//
// WHY THIS IS THE MOST IMPORTANT ROUTE IN THE WHOLE FLOW
//
// One enquiry goes to one tradesman and nothing fans out. That makes silence
// the likeliest way this fails — not a dispute, not a double booking, silence
// — and a host staring at "Sent" for a fortnight is a host who concludes the
// site does nothing. This is the route that stops that happening.
//
// WHY EVERY FIVE MINUTES
//
// It used to be hourly, which was fine when the shortest deadline was 48
// hours. An emergency now waits twenty minutes, and an hourly sweep would
// routinely hand the number over an hour after it was promised — three times
// the window, on the one case where minutes are the whole point.
//
// Five minutes is the granularity the promise can survive. The host's own
// screen settles their own rows exactly, on load, so the visible lag is
// nothing; this is what actually sends the emails, and what covers a host who
// is not looking at the page.
//
// The deciding and the writing are in lib/serviceEnquirySweep.ts, shared with
// that route. Silence means two opposite things — 'released' for an emergency,
// 'expired' for everything else — and that branch must exist once.
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');

    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    const settled = await settleDue();

    let told = 0;

    for (const outcome of ['released', 'expired'] as const) {
        for (const enquiry of settled[outcome]) {
            try {
                // The provider is loaded per row rather than in one query
                // because a release has to carry his phone number, and a
                // fetch that quietly returned nothing would send a host an
                // email promising a number with a dash where it should be.
                const { data: provider } = await admin
                    .from('service_providers')
                    .select('id, business_name, contact_email, contact_phone')
                    .eq('id', enquiry.provider_id)
                    .maybeSingle();

                let listing: any = null;
                if (enquiry.listing_id) {
                    const { data } = await admin
                        .from('listings')
                        .select('id, title, location')
                        .eq('id', enquiry.listing_id)
                        .maybeSingle();
                    listing = data;
                }

                if (outcome === 'released' && !(provider && provider.contact_phone)) {
                    // Nothing to release. It cannot normally happen — a
                    // provider without a number is never offered the emergency
                    // route — but "the email went out with a dash in it" is a
                    // bad way to find out otherwise.
                    await logError('service-enquiry-release', {
                        enquiry: String(enquiry.id),
                        problem: 'released an emergency for a provider with no phone number',
                    });
                }

                const result = await announceSilence(enquiry, provider, listing, outcome);
                if (result.host) told++;
            } catch (err: any) {
                // One host's email failing must not stop the sweep for
                // everybody behind them in the list.
                await logError('service-enquiry-silence', {
                    enquiry: String(enquiry.id),
                    outcome,
                    error: String(err && err.message),
                });
            }
        }
    }

    return NextResponse.json({
        ok: true,
        released: settled.released.length,
        expired: settled.expired.length,
        told,
    });
}
