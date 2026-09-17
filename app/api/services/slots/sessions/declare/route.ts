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
// ("four Tuesdays") and adds one OR MORE sessions to all of them (a morning and
// an afternoon class; a shared and a private) — a list they build, committed in
// one go. Every (date × session) is its own INSERT so one that clashes with a
// booking, a block, another session, or a same-time duplicate is refused ON ITS
// OWN — the rest still land. The response reports each outcome so the UI can say
// "added N, skipped these".
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

        const dates = Array.from(new Set((Array.isArray(body.dates) ? body.dates : [])
            .map((d: any) => String(d).slice(0, 10))
            .filter(isDateKey))) as string[];
        if (!dates.length) return NextResponse.json({ ok: false, error: 'Pick at least one day.' }, { status: 400 });

        const turnaround = Math.max(0, Math.floor(Number(p.slot_turnaround_minutes) || 0));
        // The sessions to add to every selected day. Each carries its own time,
        // length and capacity; a single-session add is just a one-element list.
        const sessions = (Array.isArray(body.sessions) ? body.sessions : [])
            .map((s: any) => ({
                time: String(s?.time || '').slice(0, 5),
                duration: Math.max(1, Math.floor(Number(s?.durationMinutes) || Number(p.slot_length_minutes) || 60)),
                capacity: Math.max(1, Math.floor(Number(s?.capacity) || Number(p.slot_capacity) || 1)),
                title: String(s?.title || '').trim().slice(0, 80) || null,
            }))
            .filter((s: any) => isTime(s.time));
        if (!sessions.length) return NextResponse.json({ ok: false, error: 'Add at least one session (with a time).' }, { status: 400 });

        const today = londonDayKey();
        // One INSERT per (date × session): a clash refuses only that one.
        const results: { date: string; time: string; ok: boolean; reason?: string }[] = [];
        for (const date of [...dates].sort()) {
            for (const s of sessions) {
                if (date < today) { results.push({ date, time: s.time, ok: false, reason: 'is in the past' }); continue; }
                const { error } = await admin.from('slot_sessions').insert({
                    provider_id: providerId,
                    session_date: date,
                    session_time: s.time + ':00',
                    capacity: s.capacity,
                    seats_taken: 0,
                    duration_minutes: s.duration,
                    turnaround_minutes: turnaround,
                    declared: true,
                    title: s.title,
                });
                results.push(error ? { date, time: s.time, ok: false, reason: reasonFor(error) } : { date, time: s.time, ok: true });
            }
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
