import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { announceChangeDecision, announceWorkNowClashes } from '@/lib/serviceEnquiryAlert';

export const dynamic = 'force-dynamic';

// The host answering a tradesman's request to move the day.
//
// This is the other half of propose-date, and it is the host's call because
// the host is the one who knows the cottage. Yes copies the proposed day onto
// preferred_date — the day that actually stands — and clears the proposal; no
// just clears it and leaves the original day alone. Either way the tradesman
// is told. Authorised by the host on the enquiry, under the service role.
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const enquiryId = String(body.enquiryId || '');
        const reply = String(body.reply || '');

        if (!enquiryId) {
            return NextResponse.json({ ok: false, error: 'No enquiry.' }, { status: 400 });
        }
        if (reply !== 'yes' && reply !== 'no') {
            return NextResponse.json({ ok: false, error: 'Say yes or no.' }, { status: 400 });
        }

        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
        }

        const admin = adminClient();

        const { data: enquiry } = await admin
            .from('service_enquiries')
            .select('*')
            .eq('id', enquiryId)
            .maybeSingle();
        if (!enquiry) {
            return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
        }
        if (enquiry.host_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your enquiry.' }, { status: 403 });
        }
        if (String(enquiry.status || '') !== 'accepted' || !enquiry.proposed_date) {
            return NextResponse.json({ ok: false, error: 'There is no date change to answer.' }, { status: 409 });
        }

        const now = new Date().toISOString();
        const accepted = reply === 'yes';

        const patch: any = {
            proposed_date: null,
            proposed_window_from: null,
            proposed_window_to: null,
            proposed_at: null,
            updated_at: now,
        };
        if (accepted) {
            patch.preferred_date = enquiry.proposed_date;
            if (enquiry.proposed_window_from) patch.window_from = enquiry.proposed_window_from;
            if (enquiry.proposed_window_to) patch.window_to = enquiry.proposed_window_to;
        }

        const { data: saved, error } = await admin
            .from('service_enquiries')
            .update(patch)
            .eq('id', enquiry.id)
            .eq('status', 'accepted')
            // Guard on the proposal we read: two presses cannot answer twice.
            .not('proposed_date', 'is', null)
            .select('*')
            .single();

        if (error || !saved) {
            return NextResponse.json({ ok: false, error: 'This one has already changed.' }, { status: 409 });
        }

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, contact_email')
            .eq('id', saved.provider_id)
            .maybeSingle();

        let listing: any = null;
        if (saved.listing_id) {
            const { data } = await admin.from('listings').select('id, title, location').eq('id', saved.listing_id).maybeSingle();
            listing = data;
        }

        const alert = await announceChangeDecision(saved, provider, listing, accepted);

        // IS THERE A GUEST IN THE COTTAGE ON THE NEW DAY?
        //
        // Only worth asking when the day actually moved. Declining leaves the
        // agreed date exactly where it was, and re-checking a date nobody
        // changed would warn about a collision that has been there all along.
        //
        // The platform warns about this in two other places — the enquiry form
        // when a host raises a job, and the Stripe webhook when a booking
        // lands on planned work — and both fire when a date is SET. This is
        // the only path that MOVES one, and it was the only one not looking.
        //
        // Same stance as the webhook: nothing is blocked. The host is told,
        // because the guest is the thing they cannot see from the enquiry.
        let clash = false;

        if (accepted && saved.listing_id && saved.preferred_date) {
            try {
                const { data: guests } = await admin
                    .from('bookings')
                    .select('id, check_in, check_out')
                    .eq('listing_id', saved.listing_id)
                    .eq('status', 'confirmed')
                    .lte('check_in', saved.preferred_date)
                    .gt('check_out', saved.preferred_date)
                    .limit(1);

                if (guests && guests.length) {
                    clash = true;
                    await announceWorkNowClashes(saved, listing, guests[0]);
                }
            } catch (err: any) {
                // The date change is agreed and saved by this point. Failing to
                // notice a guest must not undo it — but it must not pass as
                // "no guest", either, which is why it is reported.
                await logError('service-enquiry-date-clash', {
                    enquiry: String(saved.id),
                    error: String(err && err.message),
                });
            }
        }

        return NextResponse.json({ ok: true, accepted, clash, emailed: alert });
    } catch (err: any) {
        await logError('service-enquiry-respond-date', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
