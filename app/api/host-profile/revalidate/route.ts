import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { revalidateHostProfile } from '@/lib/revalidatePublic';

export const dynamic = 'force-dynamic';

// Refresh the signed-in person's own public host profile page. The account page
// writes a few profile fields the profile page shows — the bio and the avatar —
// straight from the browser (the browser has the grants for them), so there is
// no server write to hang a revalidate off. This is that hook: the page calls it
// after a successful save.
//
// It only ever revalidates the CALLER's own page (auth.uid()), never an id from
// the request, so it can't be used to churn someone else's cache — and a cache
// refresh is a hint with no data in it anyway. getUser(), not getSession(), so
// the id is the verified one (phone accounts have no email).
export async function POST() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false }, { status: 401 });
        revalidateHostProfile(user.id);
        return NextResponse.json({ ok: true });
    } catch {
        // Best-effort: a failed cache hint must never surface as a save error.
        return NextResponse.json({ ok: false }, { status: 200 });
    }
}
