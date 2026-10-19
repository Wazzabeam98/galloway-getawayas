// The signed-in person's push switches (account settings → Notifications).
// GET returns them with whether the person is an admin (who also gets the
// owner-alerts switch); POST changes one. Server-side so the one shared helper
// (lib/pushCategories) decides what a valid switch is: security alerts can't
// be switched off, and only admins have the owner-alerts switch.

import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { isAdmin } from '@/lib/adminAudit';
import { isPushCategory, PUSH_CATEGORY_INFO } from '@/lib/pushCategories';

export const dynamic = 'force-dynamic';

async function me() {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function GET() {
    const user = await me();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });
    const { data } = await adminClient()
        .from('notification_preferences')
        .select('push')
        .eq('user_id', user.id)
        .maybeSingle();
    return NextResponse.json({ ok: true, push: (data && data.push) || {}, isAdmin: await isAdmin(user.id) });
}

export async function POST(request: Request) {
    const user = await me();
    if (!user) return NextResponse.json({ ok: false }, { status: 401 });
    let body: any = null;
    try { body = await request.json(); } catch { /* checked below */ }
    const category = body && body.category;
    const on = body && body.on;
    if (!isPushCategory(category) || typeof on !== 'boolean') {
        return NextResponse.json({ ok: false, error: 'Unknown setting' }, { status: 400 });
    }
    const info = PUSH_CATEGORY_INFO[category];
    if (info.locked) return NextResponse.json({ ok: false, error: 'Security alerts can’t be switched off' }, { status: 400 });
    if (info.adminOnly && !(await isAdmin(user.id))) return NextResponse.json({ ok: false }, { status: 403 });

    const admin = adminClient();
    const { data: row } = await admin.from('notification_preferences').select('push').eq('user_id', user.id).maybeSingle();
    const push = { ...((row && row.push) || {}), [category]: on };
    const { error } = await admin
        .from('notification_preferences')
        .upsert({ user_id: user.id, push, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) return NextResponse.json({ ok: false }, { status: 500 });
    return NextResponse.json({ ok: true, push });
}
