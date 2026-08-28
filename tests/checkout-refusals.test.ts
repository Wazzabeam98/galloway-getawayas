// What the checkout route refuses, and the pure function underneath it.
//
// This route is the last thing between a guest and a charge. Everything it
// guards is a way of paying the wrong amount, or paying for nights somebody
// else already has, and until now none of it was covered — the route was not
// even in tsconfig.test.json, so the suite could not see the file at all.
//
// THE ORDER HERE IS DELIBERATE. totalsMatch first, because it is the smallest
// thing that can be wrong and every price guard in the route is built on it;
// then the refusals, each one driven into the state where it must fire.
//
// EVERY GUARD HERE WAS WATCHED FAILING BEFORE IT WAS TRUSTED, with
// scripts/mutate.sh. A refusal test that has only ever been seen passing is a
// test of nothing. Each of these was broken on purpose and the suite was run:
//
//   price mismatch guard removed                caught by 2
//   over-capacity guard removed                 caught by 2
//   blocked-dates guard removed                 caught by 2
//   overlap guard removed                       caught by 1
//   hold guard removed                          caught by 1
//   ownership guard removed                     caught by 1
//   already-paid guard removed                  caught by 1
//   signed-in guard removed                     caught by 1
//   valid-stay guard removed                    caught by 1
//
// And three that weaken rather than remove, because a guard that is still
// there and no longer means anything is the harder failure to notice:
//
//   totalsMatch tolerance widened to a fiver    caught by 3
//   totalsMatch always agrees                   caught by 5
//   children no longer counted towards capacity caught by 2
//
// Nothing survived. Re-run any of them with:
//   ./scripts/mutate.sh app/api/stripe/checkout/route.ts <from> <to> <label>

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

import { totalsMatch } from '../lib/pricing';

installAliases();

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://example.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const ROUTE = '@/app/api/stripe/checkout/route';
const GUEST = 'guest-1';
const HOST = 'host-1';

// ---------------------------------------------------------------------------
// totalsMatch — the pure function with no test at all
// ---------------------------------------------------------------------------
//
// It decides whether the price the guest agreed to is still the price the
// listing says. Everything about that comparison is a judgement call about
// money: how close is close enough, and which way does it fail.

test('totalsMatch accepts a total that is the same number', () => {
    assert.equal(totalsMatch(548, 548), true);
    assert.equal(totalsMatch(0, 0), true);
    assert.equal(totalsMatch(1234.56, 1234.56), true);
});

test('totalsMatch forgives the last half penny, and nothing beyond it', () => {
    // The tolerance exists because these numbers arrive from different places
    // — one computed here, one round-tripped through a numeric column and JSON
    // — and binary floating point does not promise they land on the same bits.
    assert.equal(totalsMatch(100.00, 100.004), true, 'under half a penny is the same price');
    assert.equal(totalsMatch(100.00, 100.006), false, 'over half a penny is a different price');

    // Symmetric, because the caller decides the argument order and nothing
    // about "is this the same price" should depend on which way round it asked.
    assert.equal(totalsMatch(100.006, 100.00), false);
    assert.equal(totalsMatch(100.004, 100.00), true);
});

test('totalsMatch rounds to pence before comparing', () => {
    // 0.1 + 0.2 is 0.30000000000000004. A comparison that did not round first
    // would call that a price change and refuse a booking for a hundredth of a
    // penny that does not exist in any currency.
    assert.equal(totalsMatch(0.1 + 0.2, 0.3), true);
    assert.equal(totalsMatch(548.1 + 0.2, 548.3), true);
});

test('totalsMatch refuses a real price difference, however small in context', () => {
    // A penny on a £500 booking is still a penny the guest did not agree to.
    assert.equal(totalsMatch(500.00, 500.01), false);
    assert.equal(totalsMatch(500.00, 499.99), false);
    // And the case that matters: the listing got dearer while they were typing.
    assert.equal(totalsMatch(548, 600), false);
});

test('totalsMatch treats a missing total as a mismatch, not as agreement', () => {
    // Number(null) is 0 and Number(undefined) is NaN. The route calls this with
    // Number(booking.total_price), so a null column arrives as 0 — which must
    // not silently agree with a real price. NaN must not agree with anything
    // either: `Math.abs(NaN - x) < 0.005` is false, which is the safe answer,
    // and this pins it so a future rewrite cannot make it true.
    assert.equal(totalsMatch(548, Number(null)), false, 'a null total is not the price');
    assert.equal(totalsMatch(548, Number(undefined)), false, 'nor is a missing one');
    assert.equal(totalsMatch(Number(undefined), Number(undefined)), false,
        'and two missing totals do not agree with each other');
});

// ---------------------------------------------------------------------------
// The route's refusals
// ---------------------------------------------------------------------------

// A listing whose price is easy to reason about: £100 a night, nothing else.
function listingRow(overrides: any = {}) {
    return {
        title: 'Harbour Cottage',
        cancellation_policy: 'flexible',
        price_per_night: 100,
        weekend_price: null,
        cleaning_fee: 0,
        pet_fee: 0,
        extra_guest_fee: 0,
        extra_guest_after: null,
        extra_guest_period: 'night',
        max_guests: 4,
        commission_rate: 15,
        damage_deposit: 0,
        ...overrides,
    };
}

// Three midweek nights in a month with no weekend in the way: 2026-11-02 is a
// Monday, so the 2nd, 3rd and 4th are all £100 and the total is £300. Fixed
// dates rather than offsets from today, so the arithmetic cannot start failing
// on a Friday.
function bookingRow(overrides: any = {}) {
    return {
        id: 'b-1',
        listing_id: 'l-1',
        guest_id: GUEST,
        host_id: HOST,
        check_in: '2026-11-02',
        check_out: '2026-11-05',
        total_price: 300,
        status: 'pending',
        payment_status: 'unpaid',
        adults: 2,
        children: 0,
        pets: 0,
        created_at: '2026-11-01T10:00:00Z',
        ...overrides,
    };
}

function load(opts: {
    user?: string | null;
    booking?: any;
    listing?: any;
    overrides?: any[];
    feeds?: any[];
    clashes?: any[];
    held?: any[];
} = {}) {
    const updates: any[] = [];
    const stripeCalls: any[] = [];

    function builder(table: string) {
        const state: any = { ops: [] };
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'maybeSingle') {
                    return async () => {
                        if (table === 'bookings') {
                            return {
                                data: Object.prototype.hasOwnProperty.call(opts, 'booking')
                                    ? opts.booking
                                    : bookingRow(),
                                error: null,
                            };
                        }
                        if (table === 'listings') {
                            return {
                                data: Object.prototype.hasOwnProperty.call(opts, 'listing')
                                    ? opts.listing
                                    : listingRow(),
                                error: null,
                            };
                        }
                        return { data: null, error: null };
                    };
                }
                if (prop === 'then') {
                    const update = state.ops.find((o: any) => o.op === 'update');
                    if (update) {
                        updates.push(update.args[0]);
                        return (r: any) => r({ data: null, error: null });
                    }
                    if (table === 'calendar_overrides') {
                        return (r: any) => r({ data: opts.overrides || [], error: null });
                    }
                    if (table === 'listing_ical_feeds') {
                        return (r: any) => r({ data: opts.feeds || [], error: null });
                    }
                    if (table === 'bookings') {
                        // Two different questions are asked of this table, and
                        // handing the same answer to both would let a test
                        // claiming to prove the overlap guard actually prove
                        // the hold guard, or the other way round.
                        //
                        // The hold query is the one that pins status to a
                        // single value; the overlap query asks for a set.
                        const holdQuery = state.ops.some(
                            (o: any) => o.op === 'eq' && o.args[0] === 'status'
                                && o.args[1] === 'pending_payment'
                        );
                        return (r: any) => r({
                            data: holdQuery ? (opts.held || []) : (opts.clashes || []),
                            error: null,
                        });
                    }
                    return (r: any) => r({ data: [], error: null });
                }
                return (...args: any[]) => { state.ops.push({ op: prop, args }); return chain; };
            },
        });
        return chain;
    }

    stubModule('@/lib/supabaseAdmin', { adminClient: () => ({ from: (t: string) => builder(t) }) });
    stubModule('@supabase/auth-helpers-nextjs', {
        createRouteHandlerClient: () => ({
            auth: {
                getSession: async () => ({
                    data: {
                        session: opts.user === null
                            ? null
                            : { user: { id: opts.user || GUEST, email: 'guest@example.invalid' } },
                    },
                }),
            },
        }),
    });
    stubModule('next/headers', { cookies: () => ({}) });
    stubModule('@/lib/logError', { logError: async () => undefined });
    stubModule('@/lib/email', { SITE_URL: 'http://example.invalid' });
    stubModule('@/lib/stripe', {
        stripeRequest: async (method: string, path: string, body: any) => {
            stripeCalls.push({ method, path, body });
            return { url: 'https://stripe.example.invalid/session' };
        },
    });
    stubModule('next/server', {
        NextResponse: { json: (b: any, i?: any) => ({ body: b, status: (i && i.status) || 200 }) },
    });

    clearModule(ROUTE);
    return { route: require(ROUTE.replace('@/', '../')), updates, stripeCalls };
}

const post = (body: any) =>
    new Request('http://example.invalid/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

// The harness has to be able to say yes. Without this, every refusal below
// could be the stubs failing rather than the guards firing, and the whole file
// would pass while proving nothing — which is the failure it is written against.
test('the happy path reaches Stripe, for the recalculated amount', async () => {
    const { route, stripeCalls, updates } = load();
    const res: any = await route.POST(post({ bookingId: 'b-1', plan: 'full' }));

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(stripeCalls.length, 1, 'exactly one checkout session');
    // £300, in pence, from the listing and the dates — never from the browser.
    assert.equal(stripeCalls[0].body.line_items[0].price_data.unit_amount, 30000);
    assert.equal(stripeCalls[0].body.line_items[0].price_data.currency, 'gbp');
    assert.equal(updates[updates.length - 1].status, 'pending_payment');
});

// --- 1. the price moved while the guest was deciding ------------------------

test('a price that no longer matches stops the charge', async () => {
    // The listing went to £120 a night after the booking row was written at
    // £300. Three nights is £360 now.
    const { route, stripeCalls, updates } = load({
        listing: listingRow({ price_per_night: 120 }),
    });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 409);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /360\.00/, 'and says what the price is now');
    assert.equal(stripeCalls.length, 0, 'NOTHING was charged');

    // The stored total is corrected, so the guest booking again sees the real
    // price rather than being refused for ever on a stale number.
    assert.equal(updates.length, 1);
    assert.equal(updates[0].total_price, 360);
});

test('a price that moved by a penny is still refused', async () => {
    // The guard is totalsMatch, not equality, so the boundary is worth pinning
    // at the route as well as at the function: £300.01 against £300 must not
    // be waved through as close enough.
    const { route, stripeCalls } = load({
        booking: bookingRow({ total_price: 300.01 }),
    });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 409);
    assert.equal(stripeCalls.length, 0);
});

// --- 2. blocked dates -------------------------------------------------------

test('a night blocked on the calendar stops the charge', async () => {
    const { route, stripeCalls } = load({
        overrides: [{ date: '2026-11-03', is_blocked: true, price_override: null }],
    });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 409);
    assert.match(res.body.error, /just been taken/);
    assert.equal(stripeCalls.length, 0);
});

test('a night sold on Airbnb since the guest looked stops the charge', async () => {
    // The iCal feed is the case the calendar cannot know about: those platforms
    // publish a file and tell us nothing, so the guest's calendar may be hours
    // stale. This is the last chance to catch it.
    const { route, stripeCalls } = load({
        feeds: [{ id: 'f-1', label: 'Airbnb', events: [{ start: '2026-11-03', end: '2026-11-05' }] }],
    });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 409);
    assert.equal(stripeCalls.length, 0);
});

test('a feed blocking the checkout morning does not stop the charge', async () => {
    // Half-open dates. A stay ending on the 5th needs the 2nd, 3rd and 4th; a
    // feed event covering the 5th onwards does not touch it. Getting this wrong
    // turns paying guests away, which is a failure nobody reports as a bug —
    // so it is asserted from the permissive side on purpose.
    const { route, stripeCalls } = load({
        feeds: [{ id: 'f-1', label: 'Airbnb', events: [{ start: '2026-11-05', end: '2026-11-07' }] }],
    });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 200);
    assert.equal(stripeCalls.length, 1);
});

// --- 3. more guests than the place allows -----------------------------------

test('more guests than the listing allows stops the charge', async () => {
    const { route, stripeCalls } = load({
        booking: bookingRow({ adults: 3, children: 3 }),   // six, against max_guests 4
        listing: listingRow({ max_guests: 4 }),
    });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 400);
    assert.match(res.body.error, /more guests than this place allows/);
    assert.equal(stripeCalls.length, 0);
});

test('children count towards the limit, and pets do not', async () => {
    // The rule is adults + children. A test that only ever sent adults would
    // pass with the children term deleted from the route entirely.
    const overCapacity = load({
        booking: bookingRow({ adults: 1, children: 4, pets: 0 }),
        listing: listingRow({ max_guests: 4 }),
    });
    const a: any = await overCapacity.route.POST(post({ bookingId: 'b-1' }));
    assert.equal(a.status, 400, 'five children is over a limit of four');

    const withPets = load({
        booking: bookingRow({ adults: 2, children: 0, pets: 3 }),
        listing: listingRow({ max_guests: 4, pet_fee: 0 }),
    });
    const b: any = await withPets.route.POST(post({ bookingId: 'b-1' }));
    assert.equal(b.status, 200, 'a dog is not a guest');
});

test('a listing with no stated limit does not refuse anybody', async () => {
    const { route, stripeCalls } = load({
        booking: bookingRow({ adults: 12, children: 0 }),
        listing: listingRow({ max_guests: null }),
    });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 200);
    assert.equal(stripeCalls.length, 1);
});

// --- 4. somebody else already has those nights ------------------------------

test('an overlapping confirmed booking stops the charge', async () => {
    const { route, stripeCalls } = load({ clashes: [{ id: 'b-other' }] });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 409);
    assert.match(res.body.error, /booked by someone else/);
    assert.equal(stripeCalls.length, 0);
});

// --- 5. somebody else is at the payment page right now ----------------------

test('an earlier guest holding the dates stops the charge', async () => {
    // The hold is thirty minutes and belongs to whoever started first, so both
    // requests decide it the same way however they interleave.
    const { route, stripeCalls } = load({ held: [{ id: 'b-earlier' }] });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 409);
    assert.match(res.body.error, /paying for those dates right now/);
    assert.equal(stripeCalls.length, 0);
});

// --- and the refusals that come before any of the money ---------------------

test('a signed-out visitor cannot start a checkout', async () => {
    const { route, stripeCalls } = load({ user: null });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 401);
    assert.equal(stripeCalls.length, 0);
});

test('a checkout with no booking id is refused', async () => {
    const { route, stripeCalls } = load();
    const res: any = await route.POST(post({}));

    assert.equal(res.status, 400);
    assert.equal(stripeCalls.length, 0);
});

test('a booking that does not exist is refused', async () => {
    const { route, stripeCalls } = load({ booking: null });
    const res: any = await route.POST(post({ bookingId: 'b-nope' }));

    assert.equal(res.status, 404);
    assert.equal(stripeCalls.length, 0);
});

test('somebody else’s booking cannot be paid for', async () => {
    // Not a privacy nicety: paying for a stranger's booking saves a card
    // against it and confirms dates in their name.
    const { route, stripeCalls } = load({ user: 'someone-else' });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 403);
    assert.equal(stripeCalls.length, 0);
});

test('a booking already paid for cannot be paid for twice', async () => {
    const { route, stripeCalls } = load({
        booking: bookingRow({ payment_status: 'paid' }),
    });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 400);
    assert.match(res.body.error, /already been paid/);
    assert.equal(stripeCalls.length, 0, 'and above all, is not charged again');
});

test('a listing that has gone is refused', async () => {
    const { route, stripeCalls } = load({ listing: null });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 404);
    assert.equal(stripeCalls.length, 0);
});

test('dates that are not a stay are refused', async () => {
    const { route, stripeCalls } = load({
        booking: bookingRow({ check_in: '2026-11-05', check_out: '2026-11-05', total_price: 0 }),
    });
    const res: any = await route.POST(post({ bookingId: 'b-1' }));

    assert.equal(res.status, 400);
    assert.match(res.body.error, /valid stay/);
    assert.equal(stripeCalls.length, 0);
});
