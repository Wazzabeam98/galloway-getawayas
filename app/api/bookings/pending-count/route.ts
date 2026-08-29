import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { pendingFor } from '@/lib/badgeCounts';

export const dynamic = 'force-dynamic';

// How many booking requests are sitting waiting for this host to answer.
//
// SUPERSEDED BY /api/badges — see the note in
// app/api/messages/unread-count/route.ts. Kept thin for one deploy so a tab
// still running the previous bundle keeps its badge, then deletable.
//
// The counting itself is lib/badgeCounts, which explains why it is done with
// the service key: a co-host is not the host_id on a booking row.
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession(). getSession() only decodes the auth cookie —
    // it never checks the signature — so the id below would be whatever the
    // caller wrote in it.
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ pending: 0 });
    }

    return NextResponse.json({ pending: await pendingFor(user.id) });
}
