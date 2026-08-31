import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { announceCancellation } from '@/lib/serviceEnquiryAlert';
import { canCancel } from '@/lib/serviceEnquiries';

export const dynamic = 'force-dynamic';

// Calling off a job that was already accepted. Either side may.
//
// `status` is not grantable to a browser — a host who could set 'accepted'
// would hand themselves a phone number — so, like accepting, this is a route
// under the service role. Who is allowed decides how it is worded: the
// tradesman (the provider's owner) or the host on the enquiry, nobody else.
//
// A tradesman must say why. "Can't make it" and "off sick" are different, and
// the host decides between them. A host cancelling may give a reason but is not
// made to. The reason and who-cancelled both travel into the alert to the
// other side.
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const enquiryId = String(body.enquiryId || '');
        const reason = String(body.reason || '').trim().slice(0, 2000);

        if (!enquiryId) {
            return NextResponse.json({ ok: false, error: 'No enquiry.' }, { status: 400 });
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

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id, business_name, contact_email, contact_phone')
            .eq('id', enquiry.provider_id)
            .maybeSingle();

        const isProvider = !!provider && provider.owner_id === user.id;
        const isHost = enquiry.host_id === user.id;
        if (!isProvider && !isHost) {
            return NextResponse.json({ ok: false, error: 'Not yours to cancel.' }, { status: 403 });
        }

        if (!canCancel(String(enquiry.status || ''))) {
            return NextResponse.json({
                ok: false,
                error: 'Only an accepted job can be cancelled.',
                status: enquiry.status,
            }, { status: 409 });
        }

        // The tradesman must say why; the host may.
        if (isProvider && !reason) {
            return NextResponse.json({ ok: false, error: 'Please give a reason so the host knows what to do.' }, { status: 400 });
        }

        const now = new Date().toISOString();
        const cancelledBy = isProvider ? 'provider' : 'host';

        const { data: saved, error } = await admin
            .from('service_enquiries')
            .update({
                status: 'cancelled',
                cancelled_by: cancelledBy,
                cancel_reason: reason || null,
                cancelled_at: now,
                updated_at: now,
            })
            .eq('id', enquiry.id)
            // Guarded on the status we read: two presses cannot double-cancel.
            .eq('status', 'accepted')
            .select('*')
            .single();

        if (error || !saved) {
            return NextResponse.json({ ok: false, error: 'This one has already changed.' }, { status: 409 });
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

        const alert = await announceCancellation(saved, provider, listing);

        return NextResponse.json({ ok: true, status: saved.status, cancelledBy, emailed: alert });
    } catch (err: any) {
        await logError('service-enquiry-cancel', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
