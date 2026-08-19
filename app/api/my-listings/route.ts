import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { accessibleListings, Permission } from '@/lib/access';

export const dynamic = 'force-dynamic';

const ALLOWED: Permission[] = [
    'can_calendar',
    'can_messages',
    'can_bookings',
    'can_listing',
    'can_earnings',
];

// Which properties the signed-in person may use for a given purpose — their
// own, plus any they co-host with that permission. Screens that run in the
// browser ask here rather than working it out themselves.
export async function GET(req: NextRequest) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { session } } = await supabase.auth.getSession();

    if (!session || !session.user) {
        return NextResponse.json({ listings: [] });
    }

    const asked = req.nextUrl.searchParams.get('permission') as Permission;
    const permission: Permission = ALLOWED.indexOf(asked) !== -1 ? asked : 'can_calendar';

    const all = await accessibleListings(session.user.id);

    return NextResponse.json({
        listings: all
            .filter((a) => a[permission])
            .map((a) => ({
                id: a.listingId,
                isOwner: a.isOwner,
                role: a.role,
            })),
    });
}
