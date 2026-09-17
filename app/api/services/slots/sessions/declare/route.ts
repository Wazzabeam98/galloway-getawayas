import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { londonDayKey } from '@/lib/dayKey';

export const dynamic = 'force-dynamic';

// Declare dated sessions on the diary calendar — the scheduler.
//
// The weekly template (listing editor) is the recurring baseline; a declared
// session is a specific dated one that ADDS availability where the template has
// none and takes precedence at its own interval. A declared session is a
// slot_sessions row with `declared = true` that reserves [start, start+duration+
// turnaround) even at zero seats (20260917…_dated_class + the rename).
//
// BULK, WITH PER-DATE PARTIAL SUCCESS. A provider picks several days at once
// ("four Tuesdays") and adds one session to all of them. Each date is its own
// INSERT so one date that clashes with a booking (or already has a session at
// that time) is refused ON ITS OWN — the others still land. The response reports
// each date's outcome so the UI can say "added to three, one clashed".
//
// Owner-checked, service-role write: a provider declares only on their own diary.

async function ownProvider(admin: any, providerId: string, userId: string) {
    const { data: p } = await admin
        .from('service_providers')
        .select('id, owner_id, slot_length_minutes, slot_capacity, slot_turnaround_minutes')
        .eq('id', providerId)
        .maybeSingle();
    return p && p.owner_id === userId ? p : null;
}

const isDateKey = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const isTime = (t: string) => /^\d{2}:\d{2}$/.test(t);

// A per-date reason a declaration didn't land, mapped from the database error.
function reasonFor(err: any): string {
    const code = err && err.code;
    if (code === '23P01') return 'clashes with a booking or another session';
    if (code === '23505') return 'you already have a session at that time';
    return 'could not be added';
}

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

        const time = String(body.time || '').slice(0, 5);
        if (!isTime(time)) return NextResponse.json({ ok: false, error: 'Pick a time.' }, { status: 400 });

        const dates = Array.from(new Set((Array.isArray(body.dates) ? body.dates : [])
            .map((d: any) => String(d).slice(0, 10))
            .filter(isDateKey)));
        if (!dates.length) return NextResponse.json({ ok: false, error: 'Pick at least one day.' }, { status: 400 });

        const today = londonDayKey();
        const duration = Math.max(1, Math.floor(Number(body.durationMinutes) || Number(p.slot_length_minutes) || 60));
        const capacity = Math.max(1, Math.floor(Number(body.capacity) || Number(p.slot_capacity) || 1));
        const turnaround = Math.max(0, Math.floor(Number(p.slot_turnaround_minutes) || 0));
        const title = String(body.title || '').trim().slice(0, 80) || null;

        // One INSERT per date so a clash on one date refuses only that date.
        const results: { date: string; ok: boolean; reason?: string }[] = [];
        for (const date of (dates as string[]).sort()) {
            if (date < today) { results.push({ date, ok: false, reason: 'is in the past' }); continue; }
            const { error } = await admin.from('slot_sessions').insert({
                provider_id: providerId,
                session_date: date,
                session_time: time + ':00',
                capacity,
                seats_taken: 0,
                duration_minutes: duration,
                turnaround_minutes: turnaround,
                declared: true,
                title,
            });
            results.push(error ? { date, ok: false, reason: reasonFor(error) } : { date, ok: true });
        }

        const added = results.filter((r) => r.ok).length;
        return NextResponse.json({ ok: true, added, skipped: results.length - added, results });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: 'Could not add the sessions' }, { status: 500 });
    }
}

// Remove a declared session — only while it is UNBOOKED. A declared session that
// has taken a booking is a commitment; removing it is a cancel-and-refund, which
// stays with the per-booking action in the diary (not a silent delete here).
export async function DELETE(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const providerId = String(body.providerId || '');
        const id = String(body.id || '');
        const admin = adminClient();
        const p = await ownProvider(admin, providerId, user.id);
        if (!p) return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });

        const { data: row } = await admin.from('slot_sessions')
            .select('id, provider_id, declared, seats_taken')
            .eq('id', id).eq('provider_id', providerId).maybeSingle();
        if (!row || !row.declared) return NextResponse.json({ ok: false, error: 'No such session.' }, { status: 404 });
        if (Number(row.seats_taken) > 0) {
            return NextResponse.json({ ok: false, error: 'This session has a booking. Cancel & refund it from your diary first.' }, { status: 409 });
        }

        await admin.from('slot_sessions').delete().eq('id', id).eq('provider_id', providerId);
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: 'Could not remove the session' }, { status: 500 });
    }
}
