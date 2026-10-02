import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { londonDayKey } from '@/lib/dayKey';

export const dynamic = 'force-dynamic';

// A TRADE'S DAYS OFF — the plumber's version of a host blocking dates.
//
// A host-trade has no slot schedule, so a "day off" is a whole day marked
// unavailable, stored in slot_blocks (provider_id + blocked_date) — the same
// whole-day block table the slot schedule uses, reused here for a host-trade
// (whose id never appears in any slot booking, so a row here is inert to the
// slot machinery). It is advisory: a trade agrees the actual day with the host,
// so a block does not refuse an enquiry, it just paints the day on their own
// calendar the way a host's blocked date is painted.
//
// Owner-checked both ways: a trade only ever touches their own diary.

async function ownProvider(admin: any, providerId: string, userId: string) {
    const { data: p } = await admin
        .from('service_providers')
        .select('id, owner_id')
        .eq('id', providerId)
        .maybeSingle();
    return p && p.owner_id === userId ? p : null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Block a day off. POST { providerId, day }.
export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const providerId = String(body.providerId || '');
        const day = String(body.day || '').slice(0, 10);
        const admin = adminClient();
        if (!(await ownProvider(admin, providerId, user.id))) {
            return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });
        }
        if (!DAY.test(day)) return NextResponse.json({ ok: false, error: 'Pick a day.' }, { status: 400 });
        // A day already gone can't be taken off.
        if (day < londonDayKey()) return NextResponse.json({ ok: false, error: 'That day has already passed.' }, { status: 400 });

        // Idempotent: the unique (provider_id, blocked_date) makes a repeat a no-op.
        const { error } = await admin.from('slot_blocks')
            .upsert({ provider_id: providerId, blocked_date: day }, { onConflict: 'provider_id,blocked_date' });
        if (error) return NextResponse.json({ ok: false, error: 'Could not block that day.' }, { status: 500 });
        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ ok: false, error: 'Could not block that day.' }, { status: 500 });
    }
}

// Put a day back. DELETE { providerId, day }.
export async function DELETE(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const providerId = String(body.providerId || '');
        const day = String(body.day || '').slice(0, 10);
        const admin = adminClient();
        if (!(await ownProvider(admin, providerId, user.id))) {
            return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });
        }
        if (!DAY.test(day)) return NextResponse.json({ ok: false, error: 'Pick a day.' }, { status: 400 });

        await admin.from('slot_blocks')
            .delete()
            .eq('provider_id', providerId)
            .eq('blocked_date', day);
        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ ok: false, error: 'Could not put that day back.' }, { status: 500 });
    }
}
