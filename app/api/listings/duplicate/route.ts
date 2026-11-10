import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// "Create from an existing listing" (Airbnb's duplicate). A host with several
// near-identical places — a row of pods, a set of cabins — shouldn't re-type the
// address, capacity, check-in, amenities, house rules, safety, cancellation and
// description for each one. This makes a NEW DRAFT that copies all of that from
// one of their own listings, and leaves the host to fill in what is genuinely
// per-unit: the title, the photos and the price.
//
// No new storage mechanism: it inserts an ordinary draft listings row (the same
// row the wizard creates), with the service role and an ownership check, exactly
// as /api/listings/save writes. The host then opens it in the normal /addhome
// wizard (?draft=…) and publishes it the normal way.

// What carries across. Deliberately NOT: title, images, price_per_night and the
// fees/weekend price (set per unit), min/max nights, advance notice and the
// other calendar/availability settings, the iCal links, reviews or any booking.
const COPY_COLUMNS = [
    // Address (same place; coordinates come across, the public approx_* are generated)
    'street_address', 'postcode', 'location', 'latitude', 'longitude',
    // Property type
    'property_type', 'privacy_type',
    // Capacity
    'max_guests', 'bedrooms', 'beds', 'bathrooms', 'sleeping_arrangements',
    // Check-in method and times
    'check_in_method', 'check_in_time', 'check_in_end_time', 'check_out_time',
    // Amenities
    'amenities',
    // House rules
    'max_pets', 'events_allowed', 'smoking_allowed', 'commercial_photography_allowed',
    'quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end', 'additional_rules',
    'pool_access', 'pool_setting',
    // Safety
    'guest_safety',
    // Cancellation policy
    'cancellation_policy', 'cancellation_custom_days',
    // Discounts
    'new_listing_promo', 'last_minute_discount', 'weekly_discount', 'monthly_discount',
    // Description
    'description',
];

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const sourceId: string = body && body.listingId;
        if (!sourceId) return NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 });

        const admin = adminClient();

        // Only your own listing can be copied — verified against the authenticated
        // id, never a value from the browser.
        const { data: sourceRow, error: readError } = await admin
            .from('listings')
            .select(['id', 'host_id', 'title', ...COPY_COLUMNS].join(', '))
            .eq('id', sourceId)
            .maybeSingle();
        if (readError) throw readError;
        const source = sourceRow as any;
        if (!source || source.host_id !== user.id) {
            return NextResponse.json({ ok: false, error: 'You can only copy your own listing.' }, { status: 403 });
        }

        // Build the new draft: the copied columns, plus a fresh identity — a new
        // owner-stamped draft with no title, no photos and no price.
        const row: Record<string, any> = { host_id: user.id, status: 'draft' };
        for (const col of COPY_COLUMNS) row[col] = (source as any)[col];
        row.title = '';
        row.images = [];
        row.price_per_night = 0;

        const { data: created, error: insertError } = await admin
            .from('listings')
            .insert(row)
            .select('id')
            .single();
        if (insertError || !created) {
            return NextResponse.json({ ok: false, error: (insertError && insertError.message) || 'Could not copy the listing.' }, { status: 500 });
        }

        return NextResponse.json({ ok: true, draftId: created.id, sourceTitle: (source as any).title || '' });
    } catch (err: any) {
        await logError('[listings/duplicate] ' + ((err && err.message) || 'failed'), err, { path: 'listings/duplicate' });
        return NextResponse.json({ ok: false, error: 'Something went wrong.' }, { status: 500 });
    }
}
