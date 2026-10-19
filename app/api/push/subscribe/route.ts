// Saves (POST) or forgets (DELETE) this device's push subscription for the
// signed-in person.
//
// push_subscriptions is service-role only, so this route is the browser's one
// way in. Who the row belongs to comes from the verified session, never from
// the request; the subscription itself is checked (lib/push cleanSubscription)
// so the server only ever pushes to a real browser push service.

import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { cleanSubscription, isPushEndpoint } from '@/lib/push';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

async function signedIn() {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession(): the session cookie alone is not proof.
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function POST(request: Request) {
    const user = await signedIn();
    if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

    let body: any = null;
    try { body = await request.json(); } catch { /* falls through to the check */ }
    const sub = cleanSubscription(body && body.subscription);
    if (!sub) return NextResponse.json({ ok: false, error: 'Not a push subscription' }, { status: 400 });

    const { error } = await adminClient()
        .from('push_subscriptions')
        .upsert({
            user_id: user.id,
            endpoint: sub.endpoint,
            p256dh: sub.p256dh,
            auth: sub.auth,
            user_agent: (request.headers.get('user-agent') || '').slice(0, 300) || null,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'endpoint' });

    if (error) {
        await logError('[push] could not save a push subscription', error, { path: 'api/push/subscribe', userId: user.id });
        return NextResponse.json({ ok: false }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
    const user = await signedIn();
    if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

    let body: any = null;
    try { body = await request.json(); } catch { /* falls through to the check */ }
    const endpoint = body && body.endpoint;
    if (!isPushEndpoint(endpoint)) return NextResponse.json({ ok: false }, { status: 400 });

    // Only this person's own row: signing out on a device must not reach into
    // anyone else's.
    await adminClient()
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', endpoint)
        .eq('user_id', user.id);
    return NextResponse.json({ ok: true });
}
