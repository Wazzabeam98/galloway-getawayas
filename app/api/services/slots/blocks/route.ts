import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { minutesOfDay } from '@/lib/serviceSlots';

export const dynamic = 'force-dynamic';

// PARTIAL BLOCKS — a provider closes part of a day, not just the whole one.
//
// A block is a slot_sessions row with blocked = true: it occupies
// [start, start + duration) on the provider's day and is counted by the
// no-overlap exclusion (20260914194212), so a booking inside it — and this block
// over a booking — are both refused by the DATABASE, not by app code. That is why
// this route stays thin: it inserts and deletes rows, and lets the constraint be
// the authority. Owner-checked both ways: a provider touches only their own diary.

async function ownProvider(admin: any, providerId: string, userId: string) {
    const { data: p } = await admin
        .from('service_providers')
        .select('id, owner_id')
        .eq('id', providerId)
        .maybeSingle();
    return p && p.owner_id === userId ? p : null;
}

const HHMM = /^\d{2}:\d{2}$/;
const clock = (mins: number) => String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');

// List a provider's partial blocks (future first). GET ?provider=<id>.
export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const providerId = new URL(request.url).searchParams.get('provider') || '';
        const admin = adminClient();
        if (!(await ownProvider(admin, providerId, user.id))) {
            return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });
        }

        const { data: rows } = await admin
            .from('slot_sessions')
            .select('id, session_date, session_time, duration_minutes')
            // Only the provider's OWN blocks. Imported (feed-sourced) blocks are
            // managed by removing the feed, not from this list.
            .eq('provider_id', providerId).eq('blocked', true).is('source_feed_id', null)
            .order('session_date', { ascending: true }).order('session_time', { ascending: true });

        const blocks = (rows || []).map((r: any) => {
            const startMin = minutesOfDay(String(r.session_time).slice(0, 5));
            return {
                id: r.id,
                date: r.session_date,
                start: clock(startMin),
                end: clock(startMin + (Number(r.duration_minutes) || 0)),
            };
        });
        return NextResponse.json({ ok: true, blocks });
    } catch {
        return NextResponse.json({ ok: false, error: 'Could not load the blocks' }, { status: 500 });
    }
}

// Create a partial block. POST { providerId, date, start, end }.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const providerId = String(body.providerId || '');
        const admin = adminClient();
        if (!(await ownProvider(admin, providerId, user.id))) {
            return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });
        }

        const date = String(body.date || '').slice(0, 10);
        const start = String(body.start || '').slice(0, 5);
        const end = String(body.end || '').slice(0, 5);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !HHMM.test(start) || !HHMM.test(end)) {
            return NextResponse.json({ ok: false, error: 'Pick a date and a start and end time.' }, { status: 400 });
        }
        const startMin = minutesOfDay(start);
        const endMin = minutesOfDay(end);
        if (endMin <= startMin) {
            return NextResponse.json({ ok: false, error: 'The end time has to be after the start.' }, { status: 400 });
        }
        // A block wholly in the past can't hold anything back, and lets a stale
        // form litter the diary. Compare against now on the date's own day.
        if (new Date(date + 'T' + end + ':00Z').getTime() <= Date.now()) {
            return NextResponse.json({ ok: false, error: 'That time has already passed.' }, { status: 400 });
        }

        const { data: inserted, error } = await admin.from('slot_sessions').insert({
            provider_id: providerId,
            session_date: date,
            session_time: start,
            duration_minutes: endMin - startMin,
            turnaround_minutes: 0,
            seats_taken: 0,
            capacity: 1,
            blocked: true,
            private: false,
        }).select('id').single();

        if (error) {
            // 23P01: the block overlaps a BOOKED session — refuse it rather than
            // silently shadow a slot someone has already paid for. 23505: a row
            // already exists at that exact start-time (a booking or another block).
            if ((error as any).code === '23P01') {
                return NextResponse.json({ ok: false, error: 'That overlaps a booking you’ve already taken. Cancel the booking first, or pick a time around it.' }, { status: 409 });
            }
            if ((error as any).code === '23505') {
                return NextResponse.json({ ok: false, error: 'There’s already a booking or block at that start time.' }, { status: 409 });
            }
            return NextResponse.json({ ok: false, error: 'Could not block that time.' }, { status: 500 });
        }
        return NextResponse.json({ ok: true, id: inserted?.id });
    } catch {
        return NextResponse.json({ ok: false, error: 'Could not block that time.' }, { status: 500 });
    }
}

// Remove a partial block. DELETE { providerId, id }. Only ever deletes a blocked
// row — a real booking can never be removed through here.
export async function DELETE(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const providerId = String(body.providerId || '');
        const id = String(body.id || '');
        const admin = adminClient();
        if (!(await ownProvider(admin, providerId, user.id))) {
            return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });
        }
        if (!id) return NextResponse.json({ ok: false, error: 'No block given' }, { status: 400 });

        await admin.from('slot_sessions')
            .delete()
            // Never a booking, and never an imported block — a feed-sourced block
            // is removed by removing the feed, so a stray delete here can't punch a
            // hole in what the provider's other calendar is holding back.
            .eq('id', id).eq('provider_id', providerId).eq('blocked', true).is('source_feed_id', null);
        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ ok: false, error: 'Could not remove that block' }, { status: 500 });
    }
}
