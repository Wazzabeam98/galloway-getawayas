import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/adminAudit';

export const dynamic = 'force-dynamic';

// Mark a registration off as the owner works the list: new → contacted / opened
// / dismissed. Owner-only. This is the owner's own waiting list, not moderation
// of someone else's content, so it does not demand a reason the way the listing
// visibility route does — but the isAdmin gate is checked here on the server
// every time, not left to the page hiding itself.

const STATUSES = ['new', 'contacted', 'opened', 'dismissed'];

export async function POST(request: Request) {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession(): the id must be verified by the auth server,
    // not decoded from a cookie the caller could have written.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
    }
    if (!(await isAdmin(user.id))) {
        return NextResponse.json({ ok: false, error: 'Not permitted' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const id: string = body && body.id;
    const status: string = body && body.status;

    if (!id) {
        return NextResponse.json({ ok: false, error: 'Missing registration' }, { status: 400 });
    }
    if (!STATUSES.includes(status)) {
        return NextResponse.json({ ok: false, error: 'Unknown status' }, { status: 400 });
    }

    const admin = adminClient();
    const { error } = await admin
        .from('interest_registrations')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) {
        return NextResponse.json({ ok: false, error: 'Could not update' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
}
