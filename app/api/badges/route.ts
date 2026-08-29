import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { unreadFor, pendingFor } from '@/lib/badgeCounts';

export const dynamic = 'force-dynamic';

// Both menu numbers, in one request.
//
// WHY THIS EXISTS. The dot on the hamburger and the numbers inside the menu
// came from three components — MenuUnreadDot, MessagesLink, BookingsLink —
// each instantiating its own hook, each with its own interval and its own
// fetch. A signed-in host with the menu open ran FOUR pollers for TWO
// numbers, every two minutes, before anything about auth changed.
//
// Then the routes stopped trusting getSession() and started calling
// getUser(), which is a round trip to the auth server per request. Four
// pollers meant four of those. Correct, and wasteful in a way that was
// nobody's decision — it was just what happened when three components each
// asked for what they needed.
//
// One route, one verification, one answer, shared by all three components
// through components/base/useBadgeCounts. That is one request every two
// minutes instead of four: fewer round trips than the site made BEFORE the
// auth fix, not merely fewer than after it.
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });

    // getUser(), not getSession(). getSession() only decodes the auth cookie —
    // it never checks the signature — so the id below would be whatever the
    // caller wrote in it. Once, here, rather than once per number.
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ unread: 0, pending: 0 });
    }

    // In parallel: they touch different tables and neither needs the other's
    // answer, so the request costs the slower of the two rather than the sum.
    const [unread, pending] = await Promise.all([
        unreadFor(supabase, user.id),
        pendingFor(user.id),
    ]);

    return NextResponse.json({ unread, pending });
}
