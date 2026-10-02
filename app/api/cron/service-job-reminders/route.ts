import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { announceUpcomingJob } from '@/lib/serviceEnquiryAlert';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// A REMINDER THE DAY BEFORE AN ACCEPTED JOB — the trade's version of the nudge a
// host gets before a stay.
//
// It finds every accepted enquiry whose day is TOMORROW (London) and emails the
// trade a reminder with the job and the owner's number. Scheduled once a day, so
// each job crosses the "tomorrow" line exactly once and is reminded exactly once
// — there is no per-job claim table, so the once-a-day schedule is the dedup.
// The handler always returns 200 (a single provider's email failing is logged,
// not retried), so a cron retry can never double-send.
//
// "Asked for", never "booked": nothing holds the window, so the email reminds
// the trade of the day they agreed, not a slot the platform reserved.
export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    const auth = request.headers.get('authorization');
    if (!secret || auth !== 'Bearer ' + secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
    }

    const admin = adminClient();
    const tomorrow = shiftDayKey(londonDayKey(), 1);

    let sent = 0;
    try {
        const { data: rows } = await admin
            .from('service_enquiries')
            .select('id, reference, trade, summary, fault_keys, urgency, when_note, price_snapshot, area_key, preferred_date, window_from, window_to, host_name, host_phone, provider_id, listing_id')
            .eq('status', 'accepted')
            .eq('preferred_date', tomorrow);

        for (const enquiry of rows || []) {
            try {
                const [{ data: provider }, listingRes] = await Promise.all([
                    admin.from('service_providers')
                        .select('id, contact_email, sms_opt_out')
                        .eq('id', enquiry.provider_id).maybeSingle(),
                    enquiry.listing_id
                        ? admin.from('listings').select('id, title, location').eq('id', enquiry.listing_id).maybeSingle()
                        : Promise.resolve({ data: null }),
                ]);
                const result = await announceUpcomingJob(enquiry, provider, (listingRes as any).data);
                if (result.provider) sent++;
            } catch (err: any) {
                // One trade's email failing must not stop the rest.
                await logError('service-job-reminder', { enquiry: String(enquiry.id), error: String(err && err.message) });
            }
        }
    } catch (err: any) {
        await logError('service-job-reminders-sweep', { error: String(err && err.message) });
    }

    return NextResponse.json({ ok: true, day: tomorrow, sent });
}
