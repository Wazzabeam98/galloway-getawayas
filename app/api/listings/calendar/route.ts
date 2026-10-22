import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { checkListing } from '@/lib/access';
import { guestCalendar } from '@/lib/availability';
import { checkOverridePatch, checkOverrideDates, mergeOverrides, patchChangesSomething } from '@/lib/calendarOverrides';
import { logError } from '@/lib/logError';
import { revalidateListing } from '@/lib/revalidatePublic';

export const dynamic = 'force-dynamic';

// One listing's taken nights and nightly price overrides, in ONE request, for
// the calendars that live on pages with no server parent to load them (the
// change-dates picker inside messages). Same data and same helper the listing
// page reads on the server before paint (lib/availability guestCalendar) — so
// the two can never disagree about which nights are free.
//
// It replaces three to five round trips in a row (busy nights, overrides,
// /api/ical-import and its own lookups), which is what made those calendars
// sit wide open for two seconds. Callers show a loading state until it answers,
// never an empty calendar.
//
// Who may ask: the same rule as /api/ical-import — a listing anyone can see
// (published or hidden), or one the caller can manage. Night keys and prices
// only: no names, no platforms, no feed URLs.
const PUBLICLY_VISIBLE = ['published', 'hidden'];

export async function GET(req: NextRequest) {
    const listingId = req.nextUrl.searchParams.get('listing');
    if (!listingId) return NextResponse.json({ error: 'Missing listing.' }, { status: 400 });

    const { data: listing } = await adminClient()
        .from('listings')
        .select('id, status')
        .eq('id', listingId)
        .maybeSingle();
    if (!listing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

    if (PUBLICLY_VISIBLE.indexOf(listing.status) === -1) {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        const access = user ? await checkListing(user.id, listingId, 'can_calendar') : null;
        if (access === null) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }

    return NextResponse.json(await guestCalendar(listingId));
}

// ----------------------------------------------------------------------------
// POST and DELETE: the calendar's Manage dates panel. Save a nightly price, a
// minimum stay or a block for a run of dates (POST), or reset them to the
// listing's defaults (DELETE).
//
// WHY A ROUTE. The panel used to write calendar_overrides straight from the
// browser, guarded only by a row-level policy that knows one person: the
// listing's owner. A co-host the owner had given the calendar to was refused
// with "new row violates row-level security policy" every time, and so was an
// owner whose sign-in had lapsed in the browser — the request arrived signed
// out, and the database said the same thing. Here the caller is checked with
// getUser() and the shared helper (lib/access checkListing, 'can_calendar'):
// the owner, or a co-host holding calendar permission, and nobody else. The
// listing's status doesn't matter — hidden, paused, pending or live, its
// people can manage its calendar; only what guests see depends on it.

const SIGNED_OUT = 'Your sign-in has expired. Please log in again and try once more.';

async function allowed(listingId: unknown): Promise<{ error: NextResponse; user?: undefined } | { error?: undefined; user: { id: string } }> {
    const supabase = createRouteHandlerClient({ cookies });
    // getUser(), not getSession(): the cookie alone is not proof.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: NextResponse.json({ ok: false, error: SIGNED_OUT }, { status: 401 }) };
    if (typeof listingId !== 'string' || !listingId) {
        return { error: NextResponse.json({ ok: false, error: 'Missing listing' }, { status: 400 }) };
    }
    const access = await checkListing(user.id, listingId, 'can_calendar');
    if (!access) {
        return { error: NextResponse.json({ ok: false, error: 'You don’t have permission to change this calendar.' }, { status: 403 }) };
    }
    return { user };
}

export async function POST(request: Request) {
    let body: any = null;
    try { body = await request.json(); } catch { /* checked below */ }
    const gate = await allowed(body && body.listingId);
    if (gate.error || !gate.user) return gate.error as NextResponse;

    const checked = checkOverridePatch(body);
    if (!checked.ok) return NextResponse.json({ ok: false, error: (checked as { error: string }).error }, { status: 400 });
    const p = (checked as { patch: import('@/lib/calendarOverrides').OverridePatch }).patch;

    if (!patchChangesSomething(p)) {
        return NextResponse.json({ ok: false, error: 'Change the price, the minimum stay or the block first.' }, { status: 400 });
    }

    // Only what the host changed is written; every other setting on each date
    // stays as it was (lib/calendarOverrides mergeOverrides). So a price set
    // across a month leaves its blocked nights blocked — including nights an
    // imported calendar holds, which live in the feed, not here — and leaves
    // each night's own minimum stay alone.
    const admin = adminClient();
    const { data: current, error: readError } = await admin
        .from('calendar_overrides')
        .select('date, is_blocked, price_override, min_nights_override')
        .eq('listing_id', body.listingId)
        .in('date', p.dates);
    if (readError) {
        await logError('[calendar] could not read calendar dates', readError, { path: 'api/listings/calendar', userId: gate.user.id });
        return NextResponse.json({ ok: false, error: 'Those dates couldn’t be saved. Please try again.' }, { status: 500 });
    }
    const existing: Record<string, any> = {};
    ((current as any[]) || []).forEach((r) => { existing[String(r.date).slice(0, 10)] = r; });
    const merged = mergeOverrides(p, existing);

    const rows = merged.upsert.map((r) => ({ listing_id: body.listingId, ...r }));
    if (rows.length) {
        const { error } = await admin
            .from('calendar_overrides')
            .upsert(rows, { onConflict: 'listing_id,date' });
        if (error) {
            await logError('[calendar] could not save calendar dates', error, { path: 'api/listings/calendar', userId: gate.user.id });
            return NextResponse.json({ ok: false, error: 'Those dates couldn’t be saved. Please try again.' }, { status: 500 });
        }
    }
    if (merged.clear.length) {
        const { error } = await admin
            .from('calendar_overrides')
            .delete()
            .eq('listing_id', body.listingId)
            .in('date', merged.clear);
        if (error) {
            await logError('[calendar] could not clear calendar dates', error, { path: 'api/listings/calendar', userId: gate.user.id });
            return NextResponse.json({ ok: false, error: 'Those dates couldn’t be saved. Please try again.' }, { status: 500 });
        }
    }
    // Blocked nights and per-date price/min-nights are baked into the listing
    // page's calendar — refresh it so the change shows at once.
    revalidateListing(body.listingId);
    return NextResponse.json({ ok: true, rows, cleared: merged.clear });
}

export async function DELETE(request: Request) {
    let body: any = null;
    try { body = await request.json(); } catch { /* checked below */ }
    const gate = await allowed(body && body.listingId);
    if (gate.error || !gate.user) return gate.error as NextResponse;

    const checked = checkOverrideDates(body);
    if (!checked.ok) return NextResponse.json({ ok: false, error: (checked as { error: string }).error }, { status: 400 });

    const { error } = await adminClient()
        .from('calendar_overrides')
        .delete()
        .eq('listing_id', body.listingId)
        .in('date', (checked as { dates: string[] }).dates);
    if (error) {
        await logError('[calendar] could not reset calendar dates', error, { path: 'api/listings/calendar', userId: gate.user.id });
        return NextResponse.json({ ok: false, error: 'Those dates couldn’t be reset. Please try again.' }, { status: 500 });
    }
    revalidateListing(body.listingId);
    return NextResponse.json({ ok: true });
}
