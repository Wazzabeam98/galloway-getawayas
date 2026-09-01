import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// The orders on one of the caller's businesses, for the provider dashboard.
//
// The ones awaiting an answer come first — those are the ones with a held card
// and a ticking window. getUser-verified and owner-checked: a provider sees
// only their own business's orders.
export async function GET(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        const providerId = new URL(request.url).searchParams.get('provider') || '';
        if (!providerId) {
            return NextResponse.json({ ok: false, error: 'Missing provider' }, { status: 400 });
        }

        const admin = adminClient();

        const { data: provider } = await admin
            .from('service_providers')
            .select('id, owner_id')
            .eq('id', providerId)
            .maybeSingle();

        if (!provider || provider.owner_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'Not your business' }, { status: 403 });
        }

        const { data: orders } = await admin
            .from('service_orders')
            .select('id, status, service_date, guests, price, guest_name, guest_phone, guest_email, note, expires_at, created_at')
            .eq('provider_id', providerId)
            .order('created_at', { ascending: false })
            .limit(50);

        // CONTACT IS RELEASED ON CONFIRM, NOT BEFORE.
        //
        // The same rule an accepted enquiry follows for the host: while a
        // request is only held, the provider decides on the date, the price and
        // the note — not on the guest's phone number. The moment they confirm
        // and the card is captured, they are doing the job, so they get what
        // they need to do it: name, phone and email. An unanswered or declined
        // order carries no contact out of this route at all.
        const rows = (orders || []).map((o) => {
            const released = o.status === 'confirmed';
            return {
                ...o,
                guest_phone: released ? o.guest_phone : null,
                guest_email: released ? o.guest_email : null,
            };
        }).sort((a, b) => {
            // Awaiting-answer first, then the rest by recency.
            const aWaiting = a.status === 'authorised' ? 0 : 1;
            const bWaiting = b.status === 'authorised' ? 0 : 1;
            return aWaiting - bWaiting;
        });

        return NextResponse.json({ ok: true, orders: rows });
    } catch (err: any) {
        console.error('[services/orders GET]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not load orders' }, { status: 500 });
    }
}
