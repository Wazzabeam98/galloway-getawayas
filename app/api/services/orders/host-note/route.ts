import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// A provider's private note on an experience order (order_host_notes).
//
// The twin of /api/bookings/host-note for the experience side. The note lives
// in order_host_notes, which has NO anon/authenticated grants — a guest cannot
// read it from PostgREST. This route is the whole surface, and it gates on
// ownership of the order's provider: the caller must own the service_provider
// the order belongs to (the same check the respond/cancel routes use).

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
        const { data } = await g.admin.from('order_host_notes').select('host_note').eq('order_id', orderId).maybeSingle();
        return NextResponse.json({ ok: true, note: (data && data.host_note) || null });
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

        const { error } = await g.admin
            .from('order_host_notes')
            .upsert({ order_id: orderId, host_note: note || null, updated_at: new Date().toISOString(), updated_by: g.uid }, { onConflict: 'order_id' });

        if (error) {
            await logError('[services/orders/host-note] could not save', { orderId, message: error.message }, { path: 'services/orders/host-note' });
            return NextResponse.json({ ok: false, error: 'Could not save.' }, { status: 500 });
        }
        return NextResponse.json({ ok: true, note: note || null });
    } catch (err: any) {
        await logError('[services/orders/host-note POST] ' + ((err && err.message) || 'failed'), { orderId, message: String(err && err.message) }, { path: 'services/orders/host-note' });
        return NextResponse.json({ ok: false, error: 'Could not save.' }, { status: 500 });
    }
}
