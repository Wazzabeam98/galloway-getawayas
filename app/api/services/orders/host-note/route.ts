import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// A provider's private notes on an experience order (order_host_notes) — an
// APPEND-ONLY log.
//
// The twin of /api/bookings/host-note for the experience side. The notes live
// in order_host_notes, which has NO anon/authenticated grants — a guest cannot
// read them from PostgREST. This route is the whole surface, and it gates on
// ownership of the order's provider: the caller must own the service_provider
// the order belongs to (the same check the respond/cancel routes use). POST only
// ever INSERTs a stamped entry; nothing is updated or deleted.

const MAX = 2000;

async function gate(orderId: string) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 }) };
    if (!orderId) return { error: NextResponse.json({ ok: false, error: 'Which order?' }, { status: 400 }) };

    const admin = adminClient();
    const { data: order } = await admin.from('service_orders').select('id, provider_id').eq('id', orderId).maybeSingle();
    if (!order) return { error: NextResponse.json({ ok: false, error: 'No such order.' }, { status: 404 }) };

    const { data: provider } = await admin.from('service_providers').select('id, owner_id').eq('id', order.provider_id).maybeSingle();
    if (!provider || provider.owner_id !== user.id) return { error: NextResponse.json({ ok: false, error: 'Not your order.' }, { status: 403 }) };

    return { uid: user.id, order, admin };
}

export async function GET(request: Request) {
    try {
        const orderId = new URL(request.url).searchParams.get('order') || '';
        const g = await gate(orderId);
        if (g.error) return g.error;
        const { data } = await g.admin
            .from('order_host_notes')
            .select('host_note, created_at')
            .eq('order_id', orderId)
            .order('created_at', { ascending: true });
        return NextResponse.json({ ok: true, notes: data || [] });
    } catch (err: any) {
        await logError('[services/orders/host-note GET] ' + ((err && err.message) || 'failed'), err, { path: 'services/orders/host-note' });
        return NextResponse.json({ ok: false, error: 'Could not read the note.' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    let orderId = '';
    try {
        const body = await request.json().catch(() => ({}));
        orderId = (body && body.orderId) || '';
        const g = await gate(orderId);
        if (g.error) return g.error;

        const raw = typeof body.note === 'string' ? body.note : '';
        const note = raw.trim().slice(0, MAX);
        if (!note) return NextResponse.json({ ok: false, error: 'Write something to add.' }, { status: 400 });

        // Add-only: a new stamped row each time. Never an update or a delete.
        const { data, error } = await g.admin
            .from('order_host_notes')
            .insert({ order_id: orderId, host_note: note, created_by: g.uid })
            .select('host_note, created_at')
            .single();

        if (error) {
            await logError('[services/orders/host-note] could not save', { orderId, message: error.message }, { path: 'services/orders/host-note' });
            return NextResponse.json({ ok: false, error: 'Could not save.' }, { status: 500 });
        }
        return NextResponse.json({ ok: true, note: data });
    } catch (err: any) {
        await logError('[services/orders/host-note POST] ' + ((err && err.message) || 'failed'), { orderId, message: String(err && err.message) }, { path: 'services/orders/host-note' });
        return NextResponse.json({ ok: false, error: 'Could not save.' }, { status: 500 });
    }
}
