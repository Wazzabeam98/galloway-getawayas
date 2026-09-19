import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { getImageUrl } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// The experiences a guest can review, for the prompt cards on their trips
// dashboard. The gate is unchanged and lives in the database (the "Guests can
// review after a completed experience" RLS policy + the trigger); this endpoint
// only mirrors it to decide which cards to SHOW: the guest's own orders that are
// confirmed (paid) and whose day has passed, minus the ones already reviewed.
// A guest has no read on service_orders, so this runs server-side through the
// service role, the same as every other order read.
export async function GET() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        // Behind the same flag as the rest of experiences, so the prompt never
        // appears before launch even for a guest with a qualifying past order.
        if (!guestExperiencesOpen()) {
            return NextResponse.json({ ok: true, items: [] });
        }

        const admin = adminClient();
        const today = new Date().toISOString().slice(0, 10);

        const { data: orders } = await admin
            .from('service_orders')
            .select('id, item_id, item_name, provider_id, provider_business_name, service_date')
            .eq('guest_id', user.id)
            .eq('status', 'confirmed')
            .lt('service_date', today)
            .order('service_date', { ascending: false });

        if (!orders || orders.length === 0) {
            return NextResponse.json({ ok: true, items: [] });
        }

        // Drop the ones already reviewed, so a card disappears the moment its
        // review is posted.
        const orderIds = orders.map((o) => o.id);
        const { data: reviewed } = await admin
            .from('reviews')
            .select('order_id')
            .eq('reviewer_id', user.id)
            .in('order_id', orderIds);
        const done = new Set((reviewed || []).map((r) => r.order_id));
        const pending = orders.filter((o) => !done.has(o.id));
        if (pending.length === 0) {
            return NextResponse.json({ ok: true, items: [] });
        }

        // The photo: the item's own image where the order was for a menu item,
        // falling back to the provider's first photo, then their headshot — so a
        // card always has an image to lift.
        const itemIds = Array.from(new Set(pending.map((o) => o.item_id).filter(Boolean)));
        const providerIds = Array.from(new Set(pending.map((o) => o.provider_id).filter(Boolean)));

        const [{ data: items }, { data: providers }] = await Promise.all([
            itemIds.length
                ? admin.from('service_provider_items').select('id, image').in('id', itemIds)
                : Promise.resolve({ data: [] as any[] }),
            providerIds.length
                ? admin.from('service_providers').select('id, photos, headshot').in('id', providerIds)
                : Promise.resolve({ data: [] as any[] }),
        ]);

        const itemImageById = new Map((items || []).map((it) => [it.id, it.image as string | null]));
        const providerById = new Map((providers || []).map((p) => [p.id, p]));

        const result = pending.map((o) => {
            const prov = o.provider_id ? providerById.get(o.provider_id) : null;
            const rawPhoto = itemImageById.get(o.item_id)
                || (prov && Array.isArray(prov.photos) && prov.photos[0])
                || (prov && prov.headshot)
                || null;
            return {
                orderId: o.id,
                title: o.item_name || o.provider_business_name || 'Your experience',
                providerName: o.provider_business_name || null,
                serviceDate: o.service_date,
                photo: rawPhoto ? getImageUrl(rawPhoto) : null,
            };
        });

        return NextResponse.json({ ok: true, items: result });
    } catch (err: any) {
        console.error('[services/to-review]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not load reviews to write' }, { status: 500 });
    }
}
