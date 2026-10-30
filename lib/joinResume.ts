// The server-side half of the provider sign-up, shared by /services/join and
// /business/experience (the clean address for a guest-experience sign-up). The
// reasoning lives in app/services/join/page.tsx; this is only the lookup, moved
// here so both routes resolve a returning applicant the same way.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';

export type JoinResume = { id: string; trade: string; status: string; business_name: string };

export async function resolveJoinResume(trade: string): Promise<JoinResume | null> {
    let initialResume: JoinResume | null = null;

    // Only worth a lookup once a trade is chosen — step one has no record to
    // resume, and a signed-out visitor has none either.
    if (trade) {
        const supabase = createServerComponentClient({ cookies });
        // getUser(), not getSession(): the identity is verified against the
        // auth server rather than read from a forgeable cookie, so the record
        // we hand back is the signed-in owner's own and no one else's.
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
            // Scoped to owner AND the trade in the URL. One business per trade,
            // so owner + trade names exactly one row — the application this page
            // is showing, never another person's and never a different trade of
            // the same person's. Read with the service role: a draft/pending row
            // is invisible to the browser roles by policy, and reading it here
            // is what lets the server hand the client a status it could not yet
            // see for itself.
            const admin = adminClient();
            const { data } = await admin
                .from('service_providers')
                .select('id, trade, status, business_name')
                .eq('owner_id', user.id)
                .eq('trade', trade)
                .maybeSingle();

            // A guest experience that has been sent (in review, sent back, or
            // live) is no longer created here: its listing editor shows the
            // review status and the note, and is where it is fixed and sent
            // again — the way Airbnb takes you back to your listing, not the
            // start of the sign-up. Old emails and the "Host a guest experience"
            // tile land here, so they go there too. A draft still resumes in the
            // wizard, where it was saved.
            if (data && trade === 'guest' && data.status !== 'draft') {
                redirect('/services/dashboard/listing');
            }

            if (data) {
                initialResume = {
                    id: data.id,
                    trade: data.trade,
                    status: data.status,
                    business_name: data.business_name,
                };
            }
        }
    }

    return initialResume;
}
