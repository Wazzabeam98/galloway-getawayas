import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { announceExpiry } from '@/lib/serviceEnquiryAlert';

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
// So it runs hourly rather than daily. A deadline that passes at ten in the
// morning and is noticed at eight the next day has wasted most of the day the
// host was waiting.
//
// The token is cleared as the row expires: a tradesman who answers on the
// fourth day would otherwise flip an enquiry the host has already taken
// elsewhere, and drive to a job that has been done.
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');

    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    const now = new Date().toISOString();

    const { data: due } = await admin
        .from('service_enquiries')
        .select('*')
        .in('status', ['sent', 'viewed'])
        .not('expires_at', 'is', null)
        .lte('expires_at', now)
        .limit(200);

    const rows = due || [];
    let told = 0;

    for (const enquiry of rows) {
        // Guarded on the status it was read with, so a tradesman who accepts
        // in the same minute as the sweep runs wins rather than being
        // overwritten by it.
        const { data: saved } = await admin
            .from('service_enquiries')
            .update({ status: 'expired', updated_at: now, reply_token_hash: null })
            .eq('id', enquiry.id)
            .in('status', ['sent', 'viewed'])
            .select('id')
            .maybeSingle();

        if (!saved) continue;

        let listing: any = null;
        if (enquiry.listing_id) {
            const { data } = await admin
                .from('listings')
                .select('id, title, location')
                .eq('id', enquiry.listing_id)
                .maybeSingle();
            listing = data;
        }

        try {
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

    return NextResponse.json({ ok: true, expired: rows.length, told });
}
