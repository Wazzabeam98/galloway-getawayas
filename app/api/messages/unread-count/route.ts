import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Just the number, for the badge in the menu.
//
// Kept separate from the threads route on purpose: that one builds the whole
// inbox, and the menu is on every page.
export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { session } } = await supabase.auth.getSession();

    if (!session || !session.user) {
        return NextResponse.json({ unread: 0 });
    }

    const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', session.user.id)
        .is('read_at', null);

    return NextResponse.json({ unread: count || 0 });
}
