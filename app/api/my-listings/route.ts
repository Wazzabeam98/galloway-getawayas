import { logError } from '@/lib/logError';
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
    // No try/catch at all until now, so a failure in accessibleListings threw,
    // Next answered 500, and nothing reached /admin/errors. Both callers treat
    // a non-ok response as "no properties" — so a co-host whose access lookup
    // is broken sees an empty calendar that looks exactly like having no
    // properties, and nobody is told. The status stays 500; what changes is
    // that it is now reported.
    let reporterId: string | null = null;
    try {
        const supabase = createRouteHandlerClient({ cookies });
        // getUser(), not getSession(). getSession() only decodes the auth
        // cookie — it never checks the signature — so the id below would be
        // whatever the caller wrote in it. getUser() asks the auth server,
        // which verifies the token and that the session has not been revoked.
        const { data: { user } } = await supabase.auth.getUser();
        reporterId = (user && user.id) || null;

        if (!user) {
            return NextResponse.json({ listings: [] });
        }

        const asked = req.nextUrl.searchParams.get('permission') as Permission;
        const permission: Permission = ALLOWED.indexOf(asked) !== -1 ? asked : 'can_calendar';

        const all = await accessibleListings(user.id);

        return NextResponse.json({
            listings: all
                .filter((a) => a[permission])
                .map((a) => ({
                    id: a.listingId,
                    isOwner: a.isOwner,
                    role: a.role,
                    // The rest of what they may do with it, so a screen gated on
                    // one permission can tell whether to draw a control that needs
                    // another. The calendar is the case: it opens on can_calendar,
                    // but its Pricing, Fees and Availability tabs are listing
                    // edits and need can_listing. Advisory only — every route
                    // works the answer out again on the server.
                    can_calendar: a.can_calendar,
                    can_messages: a.can_messages,
                    can_bookings: a.can_bookings,
                    can_listing: a.can_listing,
                    can_earnings: a.can_earnings,
                })),
        });
    } catch (err: any) {
        console.error('[my-listings]', err && err.message);

        await logError('my-listings: could not work out which properties someone may use', err, {
            path: 'api/my-listings',
            userId: reporterId || undefined,
        });

        return NextResponse.json(
            { ok: false, error: 'Could not load your properties', listings: [] },
            { status: 500 }
        );
    }
}
