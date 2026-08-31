import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { announceResponse } from '@/lib/serviceEnquiryAlert';
import { canRespond } from '@/lib/serviceEnquiries';

export const dynamic = 'force-dynamic';

// The same accept/decline as the emailed token link, for a provider who is
// already signed in.
//
// The token route (../respond) exists because a tradesman answering from a van
// has no session. This one is its mirror for the dashboard: identical status
// transition, identical contact release on accept, identical alert — the only
// difference is what proves it is his to answer. There, a token; here,
// ownership: getUser() must match the enquiry's provider.owner_id. The email
// flow is untouched; this is purely additive.
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const enquiryId = String(body.enquiryId || '');
        const reply = String(body.reply || '');
        const message = String(body.message || '').trim().slice(0, 2000);

        if (!enquiryId) {
            return NextResponse.json({ ok: false, error: 'No enquiry.' }, { status: 400 });
        }
        if (reply !== 'yes' && reply !== 'no') {
            return NextResponse.json({ ok: false, error: 'Say yes or no.' }, { status: 400 });
        }

        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), verified — this is an authorization decision, not display.
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

        // His to answer? The enquiry's provider must be owned by this user.
        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id, business_name, contact_email, contact_phone')
            .eq('id', enquiry.provider_id)
            .maybeSingle();

        if (!provider || provider.owner_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your enquiry.' }, { status: 403 });
        }

        if (!canRespond(String(enquiry.status || ''))) {
            return NextResponse.json({
                ok: false,
                error: 'This one has already been dealt with.',
                status: enquiry.status,
            }, { status: 409 });
        }

        const now = new Date().toISOString();

        const { data: saved, error } = await admin
            .from('service_enquiries')
            .update({
                status: reply === 'yes' ? 'accepted' : 'declined',
                responded_at: now,
                updated_at: now,
                provider_reply: reply === 'yes' && message ? message : null,
                decline_reason: reply === 'no' && message ? message : null,
            })
            .eq('id', enquiry.id)
            // Guarded on the status we read: two presses cannot answer twice.
            .in('status', ['sent', 'viewed'])
            .select('*')
            .single();

        if (error || !saved) {
            return NextResponse.json({
                ok: false,
                error: 'This one has already been dealt with.',
            }, { status: 409 });
        }

        // The accept is what releases the details — copied onto the enquiry the
        // host owns, under the service role (there is no browser grant for
        // these columns, by design). Same as the token route.
        if (saved.status === 'accepted') {
            const { data: withContact } = await admin
                .from('service_enquiries')
                .update({
                    provider_phone: provider.contact_phone || null,
                    provider_email: provider.contact_email || null,
                    updated_at: now,
                })
                .eq('id', saved.id)
                .select('*')
                .maybeSingle();
            if (withContact) Object.assign(saved, withContact);
        }

        let listing: any = null;
        if (saved.listing_id) {
            const { data } = await admin
                .from('listings')
                .select('id, title, location')
                .eq('id', saved.listing_id)
                .maybeSingle();
            listing = data;
        }

        const alert = await announceResponse(saved, provider, listing);

        return NextResponse.json({ ok: true, status: saved.status, emailed: alert });
    } catch (err: any) {
        await logError('service-enquiry-respond-as-owner', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
