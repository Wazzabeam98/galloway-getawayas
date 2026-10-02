import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { hasUkPostcode } from '@/lib/postcode';

export const dynamic = 'force-dynamic';

// A signed-in guest's saved delivery addresses — the address book behind the
// food basket's one-tap picks.
//
// User-scoped by design: every query runs through the guest's own Supabase
// session (createRouteHandlerClient), so row-level security pins each read and
// write to guest_id = auth.uid(). There is no service-role client here and no
// guest_id trusted from the browser — a caller can only ever touch their own
// rows, whatever they send.
//
// The addresses are a convenience, not money: the order route freezes its own
// service_address, so nothing here can change an order already placed.

// The most a guest keeps. Enough for home, a holiday cottage and a relative or
// two; past that the pick list stops being a shortcut. The oldest-used is
// dropped when a new one would exceed it.
const MAX_SAVED = 8;

export async function GET() {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        // Not an error — an anonymous basket simply has no saved list.
        return NextResponse.json({ ok: true, addresses: [] });
    }

    const { data, error } = await supabase
        .from('guest_delivery_addresses')
        .select('id, house, street, town, postcode, line, last_used_at')
        .order('last_used_at', { ascending: false })
        .limit(MAX_SAVED);

    if (error) {
        console.error('[guest/delivery-addresses GET]', error.message);
        return NextResponse.json({ ok: false, error: 'Could not load your saved addresses.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, addresses: data || [] });
}

// Save (or refresh) one address. Deduped on the composed line, case-insensitive:
// a repeat save bumps last_used_at rather than adding a near-duplicate, which is
// also how a pick "touches" an address so it floats to the top next time.
export async function POST(request: Request) {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    // Signed-in only. An anonymous booker has no account to save against; the
    // basket just doesn't call this for them.
    if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const house = String(body?.house || '').slice(0, 120).trim();
    const street = String(body?.street || '').slice(0, 200).trim();
    const town = String(body?.town || '').slice(0, 120).trim();
    const postcode = String(body?.postcode || '').slice(0, 20).trim();
    const line = String(body?.line || '').slice(0, 300).trim();

    // The same floor the order route enforces: an address with no postcode is not
    // a deliverable address. Everything else is optional (a rural address may be
    // only a house name and a postcode), so only the postcode is required.
    if (!line || !postcode || !hasUkPostcode(line)) {
        return NextResponse.json({ ok: false, error: 'A saved address needs a full address including a postcode.' }, { status: 400 });
    }

    // Already have this exact line? Touch it (bump last_used_at) instead of
    // inserting a duplicate. RLS scopes the match to this guest's own rows.
    const { data: existing } = await supabase
        .from('guest_delivery_addresses')
        .select('id')
        .ilike('line', line)
        .limit(1)
        .maybeSingle();

    if (existing) {
        const { data: updated, error: upErr } = await supabase
            .from('guest_delivery_addresses')
            .update({ last_used_at: new Date().toISOString(), house, street, town, postcode })
            .eq('id', existing.id)
            .select('id, house, street, town, postcode, line')
            .maybeSingle();
        if (upErr) {
            console.error('[guest/delivery-addresses POST update]', upErr.message);
            return NextResponse.json({ ok: false, error: 'Could not save that address.' }, { status: 500 });
        }
        return NextResponse.json({ ok: true, address: updated });
    }

    const { data: inserted, error: insErr } = await supabase
        .from('guest_delivery_addresses')
        // guest_id defaults to auth.uid() and the RLS with-check pins it — never
        // sent from the browser.
        .insert({ house, street, town, postcode, line })
        .select('id, house, street, town, postcode, line')
        .maybeSingle();
    if (insErr) {
        console.error('[guest/delivery-addresses POST insert]', insErr.message);
        return NextResponse.json({ ok: false, error: 'Could not save that address.' }, { status: 500 });
    }

    // Keep the book to MAX_SAVED: drop the oldest-used beyond the cap. Best-effort
    // — a save that succeeds shouldn't fail because the prune did.
    const { data: all } = await supabase
        .from('guest_delivery_addresses')
        .select('id')
        .order('last_used_at', { ascending: false });
    if (all && all.length > MAX_SAVED) {
        const stale = all.slice(MAX_SAVED).map((r: { id: string }) => r.id);
        if (stale.length) await supabase.from('guest_delivery_addresses').delete().in('id', stale);
    }

    return NextResponse.json({ ok: true, address: inserted });
}
