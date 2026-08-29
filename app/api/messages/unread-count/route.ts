import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { unreadFor } from '@/lib/badgeCounts';

export const dynamic = 'force-dynamic';

// Just the number, for the badge in the menu.
//
// SUPERSEDED BY /api/badges, WHICH ANSWERS THIS AND THE PENDING COUNT IN ONE
// REQUEST. Nothing in this repo calls it any more. It is kept, thin, for the
// length of one deploy: a browser with the previous bundle open goes on
// polling this address until it reloads, and 404ing at it would freeze that
// tab's badge for no reason. Delete it once no old client can still be open.
//
// The counting itself is lib/badgeCounts — one copy, so this and /api/badges
// cannot drift on the archived-conversation rule.
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession(). getSession() only decodes the auth cookie —
    // it never checks the signature — so the id below would be whatever the
    // caller wrote in it.
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ unread: 0 });
    }

    return NextResponse.json({ unread: await unreadFor(supabase, user.id) });
}
