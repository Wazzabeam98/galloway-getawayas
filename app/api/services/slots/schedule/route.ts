import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// A slot provider's schedule — the weekly opening hours, the slot length and
// capacity, and the blocked days. Read on the dashboard (to block a day) and in
// the sign-up (to set it up). Owner-checked both ways: a provider touches only
// their own schedule.

async function ownProvider(admin: any, providerId: string, userId: string) {
    const { data: p } = await admin
        .from('service_providers')
        .select('id, owner_id, slot_length_minutes, slot_capacity')
        .eq('id', providerId)
        .maybeSingle();
    return p && p.owner_id === userId ? p : null;
}

export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const providerId = new URL(request.url).searchParams.get('provider') || '';
        const admin = adminClient();
        const p = await ownProvider(admin, providerId, user.id);
        if (!p) return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });

        const [{ data: availability }, { data: blocks }] = await Promise.all([
            admin.from('slot_availability').select('day_of_week, open_time, close_time').eq('provider_id', providerId)
                .order('day_of_week', { ascending: true }),
            admin.from('slot_blocks').select('blocked_date').eq('provider_id', providerId).order('blocked_date', { ascending: true }),
        ]);

        return NextResponse.json({
            ok: true,
            slot_length_minutes: p.slot_length_minutes || 60,
            slot_capacity: p.slot_capacity || 1,
            availability: availability || [],
            blocks: (blocks || []).map((b: any) => b.blocked_date),
        });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: 'Could not load the schedule' }, { status: 500 });
    }
}

// Replace the whole schedule. The editor and the dashboard both send the full
// picture back, so a removed day or an unblocked date simply isn't in the list —
// the same wholesale shape the areas save uses.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const providerId = String(body.providerId || '');
        const admin = adminClient();
        const p = await ownProvider(admin, providerId, user.id);
        if (!p) return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });

        // Provider-level config, clamped to sane bounds.
        const patch: any = {};
        if (body.slot_length_minutes !== undefined) {
            patch.slot_length_minutes = Math.min(600, Math.max(15, Math.floor(Number(body.slot_length_minutes) || 60)));
        }
        if (body.slot_capacity !== undefined) {
            patch.slot_capacity = Math.min(200, Math.max(1, Math.floor(Number(body.slot_capacity) || 1)));
        }
        if (Object.keys(patch).length) await admin.from('service_providers').update(patch).eq('id', providerId);

        if (Array.isArray(body.availability)) {
            await admin.from('slot_availability').delete().eq('provider_id', providerId);
            const rows = body.availability
                .map((a: any) => ({
                    provider_id: providerId,
                    day_of_week: Math.max(0, Math.min(6, Math.floor(Number(a.day_of_week)))),
                    open_time: String(a.open_time || '').slice(0, 5),
                    close_time: String(a.close_time || '').slice(0, 5),
                }))
                .filter((r: any) => /^\d\d:\d\d$/.test(r.open_time) && /^\d\d:\d\d$/.test(r.close_time) && r.open_time < r.close_time);
            if (rows.length) await admin.from('slot_availability').insert(rows);
        }

        if (Array.isArray(body.blocks)) {
            await admin.from('slot_blocks').delete().eq('provider_id', providerId);
            const rows = Array.from(new Set(body.blocks.map((d: any) => String(d).slice(0, 10))))
                .filter((d: any) => /^\d{4}-\d{2}-\d{2}$/.test(d))
                .map((d: any) => ({ provider_id: providerId, blocked_date: d }));
            if (rows.length) await admin.from('slot_blocks').insert(rows);
        }

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: 'Could not save the schedule' }, { status: 500 });
    }
}
