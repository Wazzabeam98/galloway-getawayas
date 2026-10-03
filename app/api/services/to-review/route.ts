import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { guestExperienceLists } from '@/lib/guestExperienceLists';

export const dynamic = 'force-dynamic';

// A guest's own experience orders, either side of today — read server-side
// because a guest has no read on service_orders (the same service-role read as
// every other order).
//
//   items    — confirmed orders whose day has PASSED and aren't yet reviewed,
//              for the review-prompt cards on the trips dashboard (ReviewPrompts).
//   upcoming — confirmed orders still to COME, nearest first, for the "Your
//              upcoming experience" card on the home page (UpcomingExperience).
//
// Both are the same rows with the same photo/title/provider shape, so this one
// endpoint serves both rather than a near-duplicate third. The gate is the
// database's; this only mirrors it (confirmed = paid) to decide what to show,
// and stays behind guestExperiencesOpen like the rest of the feature.
export async function GET() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const { items, upcoming } = await guestExperienceLists(user.id);
        return NextResponse.json({ ok: true, items, upcoming });
    } catch (err: any) {
        console.error('[services/to-review]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not load experiences' }, { status: 500 });
    }
}
