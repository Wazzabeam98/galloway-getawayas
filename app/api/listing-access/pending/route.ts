// The signed-in person's co-host invitations still waiting for an answer
// (lib/pendingInvites). Their own invitations only — matched on their verified
// sign-in address — so returning each one's token to them gives nothing away.

import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { pendingInvitesFor } from '@/lib/pendingInvites';

export const dynamic = 'force-dynamic';

export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ invites: [] });
    return NextResponse.json({ invites: await pendingInvitesFor(adminClient(), user.email) });
}
