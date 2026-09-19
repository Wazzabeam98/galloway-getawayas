import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { getImageUrl } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// A guest's own experience orders, either side of today — read server-side
// because a guest has no read on service_orders (the same service-role read as
// every other order).
//
//   items    — confirmed orders whose day has PASSED and aren't yet reviewed,
//              for the review-prompt cards on the trips dashboard (ReviewPrompts).
//   upcoming — confirmed orders still to COME, nearest first, for the "Your
//              upcoming experience" card on the home page (UpcomingExperience).
//
// Both are the same rows with the same photo/title/provider shape, so this one
// endpoint serves both rather than a near-duplicate third. The gate is the
// database's; this only mirrors it (confirmed = paid) to decide what to show,
// and stays behind guestExperiencesOpen like the rest of the feature.
export async function GET() {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
        }

        if (!guestExperiencesOpen()) {
            return NextResponse.json({ ok: true, items: [], upcoming: [] });
        }

        const admin = adminClient();
        const today = new Date().toISOString().slice(0, 10);

        // Past (to review) and future (upcoming), in one round trip each.
        const [{ data: pastOrders }, { data: futureOrders }] = await Promise.all([
            admin
                .from('service_orders')
                .select('id, item_id, item_name, provider_id, provider_business_name, service_date, service_time')
                .eq('guest_id', user.id)
                .eq('status', 'confirmed')
                .lt('service_date', today)
                .order('service_date', { ascending: false }),
            admin
                .from('service_orders')
                .select('id, item_id, item_name, provider_id, provider_business_name, service_date, service_time')
                .eq('guest_id', user.id)
                .eq('status', 'confirmed')
                .gte('service_date', today)
                .order('service_date', { ascending: true })
                .order('service_time', { ascending: true, nullsFirst: true }),
        ]);

        const past = pastOrders || [];
        const future = futureOrders || [];

        // Drop past orders already reviewed, so a review-prompt disappears the
        // moment its review is posted. (Upcoming can't have been reviewed yet.)
        let toReview = past;
        if (past.length) {
            const { data: reviewed } = await admin
                .from('reviews')
                .select('order_id')
                .eq('reviewer_id', user.id)
                .in('order_id', past.map((o) => o.id));
            const done = new Set((reviewed || []).map((r) => r.order_id));
            toReview = past.filter((o) => !done.has(o.id));
        }

        if (toReview.length === 0 && future.length === 0) {
            return NextResponse.json({ ok: true, items: [], upcoming: [] });
        }

        // One photo lookup across both sets: the item's own image, else the
        // provider's first photo, else their headshot — so a card always has an
        // image to lift.
        const all = [...toReview, ...future];
        const itemIds = Array.from(new Set(all.map((o) => o.item_id).filter(Boolean)));
        const providerIds = Array.from(new Set(all.map((o) => o.provider_id).filter(Boolean)));

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

        const photoFor = (o: any): string | null => {
            const prov = o.provider_id ? providerById.get(o.provider_id) : null;
            const raw = itemImageById.get(o.item_id)
                || (prov && Array.isArray(prov.photos) && prov.photos[0])
                || (prov && prov.headshot)
                || null;
            return raw ? getImageUrl(raw) : null;
        };

        const reviewShape = (o: any) => ({
            orderId: o.id,
            title: o.item_name || o.provider_business_name || 'Your experience',
            providerName: o.provider_business_name || null,
            serviceDate: o.service_date,
            photo: photoFor(o),
        });
        const upcomingShape = (o: any) => ({
            orderId: o.id,
            title: o.item_name || o.provider_business_name || 'Your experience',
            providerName: o.provider_business_name || null,
            serviceDate: o.service_date,
            serviceTime: o.service_time || null,
            photo: photoFor(o),
        });

        return NextResponse.json({
            ok: true,
            items: toReview.map(reviewShape),
            upcoming: future.map(upcomingShape),
        });
    } catch (err: any) {
        console.error('[services/to-review]', err && err.message);
        return NextResponse.json({ ok: false, error: 'Could not load experiences' }, { status: 500 });
    }
}
