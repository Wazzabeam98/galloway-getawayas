// Sends one test push notification to the signed-in admin's own devices, and
// says what the push service answered. Used by the button on
// /admin/notifications, which calls it once per push type (lib/pushCatalogue).
//
// Admins only, and only ever to the caller's own subscriptions — the user id
// comes from the verified session, never from the request. Reads
// push_subscriptions and nothing else; no booking, message or payment row is
// read or written.

import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { isAdmin } from '@/lib/adminAudit';
import { pushToUserReport } from '@/lib/push';
import { catalogueTestPush } from '@/lib/pushCatalogue';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession(): the cookie alone is not proof.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !(await isAdmin(user.id))) {
        return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }

    let body: any = null;
    try { body = await request.json(); } catch { /* checked below */ }
    const msg = typeof (body && body.id) === 'string' ? catalogueTestPush(body.id) : null;
    if (!msg) {
        return NextResponse.json({ ok: false, error: 'Unknown test' }, { status: 400 });
    }

    const report = await pushToUserReport(adminClient(), user.id, msg);
    return NextResponse.json({ ok: true, report });
}
