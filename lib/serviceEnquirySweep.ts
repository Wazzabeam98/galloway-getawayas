// What happens when nobody answers.
//
// ONE IMPLEMENTATION, TWO CALLERS, AND THAT IS THE WHOLE REASON THIS FILE EXISTS
//
//   /api/cron/service-enquiries       every five minutes, everybody's rows.
//                                     Sends the emails.
//   /api/services/enquiries/refresh   one host's own rows, when they load
//                                     their list.
//
// The second exists because of the twenty-minute emergency window. A sweep
// running every five minutes means a host can sit looking at "waiting" for up
// to five minutes after their enquiry had already run out — which, for the one
// case where minutes are the entire point, is a quarter of the window spent
// staring at a stale screen. So their own page settles their own rows on load,
// exactly, and the cron remains the thing that actually tells people.
//
// SILENCE HAS ONE ENDING
//
// Every urgency expires the same way and the host is told to try somebody
// else. There was briefly a second ending — an unanswered emergency released
// the tradesman's number — and it is gone: an introduction the platform gives
// away is not one it can charge for. An accept is the only route to a phone
// number. See the note above URGENCY_LEVELS in lib/serviceEnquiries.ts before
// adding anything here.

import { adminClient } from '@/lib/supabaseAdmin';
import { hasExpired } from '@/lib/serviceEnquiries';

export interface SweepResult {
    expired: any[];
}

// Settles every row whose time is up, and RETURNS them rather than emailing.
//
// Sending is the caller's job on purpose: the cron tells people, and the
// host's own page must not — they are looking at the screen, the screen has
// just changed, and an email saying what they can already see is noise.
export async function settleDue(hostId?: string | null): Promise<SweepResult> {
    const admin = adminClient();
    const now = new Date();

    let query = admin
        .from('service_enquiries')
        .select('*')
        .in('status', ['sent', 'viewed'])
        .lte('expires_at', now.toISOString())
        .limit(200);

    if (hostId) query = query.eq('host_id', hostId);

    const { data: due } = await query;

    const result: SweepResult = { expired: [] };

    for (const enquiry of due || []) {
        if (!hasExpired(enquiry, now)) continue;

        const { data: saved } = await admin
            .from('service_enquiries')
            .update({
                status: 'expired',
                updated_at: now.toISOString(),
                // The link dies with the wait. A tradesman answering an hour
                // late would otherwise flip a row the host has already given
                // up on and acted elsewhere about.
                reply_token_hash: null,
            })
            .eq('id', enquiry.id)
            // Guarded on the status it was read with, so a tradesman accepting
            // in the same second as the sweep wins rather than being
            // overwritten by it. He answered; the clock merely ran.
            .in('status', ['sent', 'viewed'])
            .select('*')
            .maybeSingle();

        if (!saved) continue;
        result.expired.push(saved);
    }

    return result;
}
