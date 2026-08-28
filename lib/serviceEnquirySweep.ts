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
// to five minutes after the number was due — which, for the one case where
// minutes are the entire point, is most of a quarter of the window spent
// staring at a stale screen. So their own page settles their own rows on load,
// exactly, and the cron remains the thing that actually tells people.
//
// Two callers is also how two answers get written, so neither of them decides
// anything: `dueOutcome` decides, here, once.
//
// SILENCE MEANS TWO OPPOSITE THINGS
//
//   ordinary work   'expired'  — try somebody else
//   an emergency    'released' — here is his number, ring him
//
// Getting that backwards would either strand a host mid-emergency or hand out
// a tradesman's number because a quote went quiet, so the branch is in one
// function with a test on it rather than repeated at two call sites.

import { adminClient } from '@/lib/supabaseAdmin';
import { dueOutcome } from '@/lib/serviceEnquiries';

export interface SweepResult {
    released: any[];
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

    const result: SweepResult = { released: [], expired: [] };

    for (const enquiry of due || []) {
        const outcome = dueOutcome(enquiry, now);
        if (!outcome) continue;

        const patch: any = {
            status: outcome,
            updated_at: now.toISOString(),
            // The link dies with the wait. A tradesman answering an hour late
            // would otherwise flip a row the host has already acted on — and
            // in the released case, accept something whose number he has
            // already been rung on.
            reply_token_hash: null,
        };

        // Separate from responded_at, always. One is a person deciding and the
        // other is a clock running out; counting them together would flatter
        // the accept rate that the whole emergency design exists to produce.
        if (outcome === 'released') patch.released_at = now.toISOString();

        const { data: saved } = await admin
            .from('service_enquiries')
            .update(patch)
            .eq('id', enquiry.id)
            // Guarded on the status it was read with, so a tradesman accepting
            // in the same second as the sweep wins rather than being
            // overwritten by it. He answered; the clock merely ran.
            .in('status', ['sent', 'viewed'])
            .select('*')
            .maybeSingle();

        if (!saved) continue;

        if (outcome === 'released') result.released.push(saved);
        else result.expired.push(saved);
    }

    return result;
}
