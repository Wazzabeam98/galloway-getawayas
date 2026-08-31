import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { announceAmendment } from '@/lib/serviceEnquiryAlert';

export const dynamic = 'force-dynamic';

// The tradesman moving an accepted job to a different day.
//
// `preferred_date` is the host's request, not something a provider normally
// writes — so, like accepting and cancelling, this goes through a route under
// the service role and is authorised by provider ownership. It stays 'accepted'
// (he still means to come, just on another day) and the host is told.
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const enquiryId = String(body.enquiryId || '');
        const preferredDate = String(body.preferred_date || '').trim();
        const windowFrom = body.window_from ? String(body.window_from) : null;
        const windowTo = body.window_to ? String(body.window_to) : null;

        if (!enquiryId || !preferredDate) {
            return NextResponse.json({ ok: false, error: 'Need an enquiry and a date.' }, { status: 400 });
        }
        // A plain YYYY-MM-DD, and not in the past.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
            return NextResponse.json({ ok: false, error: 'That date is not valid.' }, { status: 400 });
        }
        const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
        if (preferredDate < todayKey) {
            return NextResponse.json({ ok: false, error: 'Pick a day that hasn’t passed.' }, { status: 400 });
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

        const previousDate = enquiry.preferred_date || null;
        const now = new Date().toISOString();

        const patch: any = { preferred_date: preferredDate, updated_at: now };
        if (windowFrom !== null) patch.window_from = windowFrom;
        if (windowTo !== null) patch.window_to = windowTo;

        const { data: saved, error } = await admin
            .from('service_enquiries')
            .update(patch)
            .eq('id', enquiry.id)
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

        const alert = await announceAmendment(saved, provider, listing, previousDate);

        return NextResponse.json({ ok: true, emailed: alert });
    } catch (err: any) {
        await logError('service-enquiry-amend', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
