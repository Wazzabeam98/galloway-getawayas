import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';
import { settleDue } from '@/lib/serviceEnquirySweep';

export const dynamic = 'force-dynamic';

// A host's own rows, settled exactly, when they open their list.
//
// WHY IT IS NOT ENOUGH TO WAIT FOR THE CRON
//
// An emergency waits twenty minutes and the sweep runs every five. Without
// this, a host refreshing at minute twenty-one can still be looking at
// "waiting" — and the one case where the whole design is about minutes is the
// one where a stale screen is least forgivable.
//
// So their own page settles their own rows on load. Nothing is emailed from
// here: they are looking at the screen and it has just changed, and an email
// telling them what is in front of them is noise. The cron still sends,
// because a host who is NOT looking at the page is the one who needs telling.
//
// It cannot touch anybody else's rows: settleDue is scoped to the signed-in
// user's id, and the decision about what silence means is the same function
// the cron calls.
export async function POST() {
    try {
        const supabase = createRouteHandlerClient({ cookies });

        const { data: auth } = await supabase.auth.getUser();
        if (!auth || !auth.user) {
            return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
        }

        const settled = await settleDue(auth.user.id);

        return NextResponse.json({
            ok: true,
            released: settled.released.length,
            expired: settled.expired.length,
        });
    } catch (err: any) {
        await logError('service-enquiry-refresh', err);
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
