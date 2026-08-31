import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { announceProposedChange } from '@/lib/serviceEnquiryAlert';

export const dynamic = 'force-dynamic';

// The tradesman ASKING to move an accepted job to a different day.
//
// He cannot move it himself: the host is the one who knows whether a guest is
// in the cottage that day, and an accepted job is close to a booking. So this
// only records a proposal — proposed_date — and emails the host to accept or
// decline. preferred_date, the day that actually stands, is untouched until
// the host agrees (see respond-date). Authorised by provider ownership, under
// the service role, like accepting.
//
// Passing null clears a proposal he no longer wants to make.
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const enquiryId = String(body.enquiryId || '');
        const clear = body.clear === true;
        const proposedDate = clear ? null : String(body.proposed_date || '').trim();
        const windowFrom = body.window_from ? String(body.window_from) : null;
        const windowTo = body.window_to ? String(body.window_to) : null;

        if (!enquiryId) {
            return NextResponse.json({ ok: false, error: 'No enquiry.' }, { status: 400 });
        }
        if (!clear) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(proposedDate || '')) {
                return NextResponse.json({ ok: false, error: 'That date is not valid.' }, { status: 400 });
            }
            const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
            if ((proposedDate as string) < todayKey) {
                return NextResponse.json({ ok: false, error: 'Pick a day that hasn’t passed.' }, { status: 400 });
            }
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
            .select('id, owner_id')
            .eq('id', enquiry.provider_id)
            .maybeSingle();
        if (!provider || provider.owner_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your job.' }, { status: 403 });
        }
        if (String(enquiry.status || '') !== 'accepted') {
            return NextResponse.json({ ok: false, error: 'Only an accepted job can be moved.' }, { status: 409 });
        }

        const now = new Date().toISOString();

        const { data: saved, error } = await admin
            .from('service_enquiries')
            .update({
                proposed_date: proposedDate,
                proposed_window_from: clear ? null : windowFrom,
                proposed_window_to: clear ? null : windowTo,
                proposed_at: clear ? null : now,
                updated_at: now,
            })
            .eq('id', enquiry.id)
            .eq('status', 'accepted')
            .select('*')
            .single();

        if (error || !saved) {
            return NextResponse.json({ ok: false, error: 'This one has already changed.' }, { status: 409 });
        }

        // Only tell the host when there is something to tell — not on a clear.
        let alert: any = null;
        if (!clear) {
            let listing: any = null;
            if (saved.listing_id) {
                const { data } = await admin.from('listings').select('id, title, location').eq('id', saved.listing_id).maybeSingle();
                listing = data;
            }
            alert = await announceProposedChange(saved, provider, listing);
        }

        return NextResponse.json({ ok: true, emailed: alert });
    } catch (err: any) {
        await logError('service-enquiry-propose-date', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
