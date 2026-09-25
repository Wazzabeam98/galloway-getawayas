import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// "Deliver to my cottage" — the signed-in guest's own confirmed stay(s) that
// cover a given delivery date, so the food basket can offer a one-tap fill from
// the stay's private address without spending an address lookup.
//
// WHY THE SERVICE ROLE. The cottage's private street address is revoked from the
// browser (listing_private_columns), so the guest's own session cannot read it.
// This route reads it with the service role and hands it back ONLY for the
// caller's own bookings — guest_id is pinned to the signed-in user, never taken
// from the browser — and only for a CONFIRMED stay the guest has paid for. That
// is the guest's own address, which they may of course see.
//
// The date is a yyyy-mm-dd day key. A stay covers it when check_in <= date and
// date < check_out (check_out is the departure morning, so the last night is the
// day before) — the same span the order route uses to bound a service date.
export async function GET(request: Request) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    // Anonymous baskets have no stays to offer; not an error, just an empty list.
    if (!user) return NextResponse.json({ ok: true, stays: [] });

    const date = (new URL(request.url).searchParams.get('date') || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ ok: false, error: 'A valid date is required.' }, { status: 400 });
    }

    const admin = adminClient();
    const { data: bookings, error } = await admin
        .from('bookings')
        .select('id, listing_id, check_in, check_out, status')
        .eq('guest_id', user.id)
        .eq('status', 'confirmed')
        .lte('check_in', date)
        .gt('check_out', date);

    if (error) {
        console.error('[guest/delivery-stays]', error.message);
        return NextResponse.json({ ok: false, error: 'Could not check your stays.' }, { status: 500 });
    }
    if (!bookings || !bookings.length) return NextResponse.json({ ok: true, stays: [] });

    const listingIds = Array.from(new Set(bookings.map((b) => b.listing_id).filter(Boolean)));
    const { data: listings } = listingIds.length
        ? await admin.from('listings').select('id, title, street_address, postcode, location').in('id', listingIds)
        : { data: [] as any[] };
    const byId = new Map<string, any>((listings || []).map((l: any) => [l.id, l]));

    // One entry per stay, with the composed private address the order route would
    // otherwise build server-side — the exact same [street, postcode, town] join,
    // so a "Deliver to my cottage" pick and an against-a-stay order agree.
    const stays = bookings
        .map((b) => {
            const l = b.listing_id ? byId.get(b.listing_id) : null;
            if (!l) return null;
            const line = [l.street_address, l.postcode, l.location].filter(Boolean).join(', ');
            if (!line) return null;
            return {
                bookingId: b.id,
                propertyName: l.title || 'your cottage',
                town: l.location || '',
                postcode: l.postcode || '',
                line,
            };
        })
        .filter(Boolean);

    return NextResponse.json({ ok: true, stays });
}
