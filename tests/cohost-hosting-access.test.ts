// A co-host is a host too.
//
// readWorkSide decides whether someone is shown "Switch to hosting" and the
// host menu at all. It used to count only listings they owned (host_id), so a
// pure co-host — invited onto someone else's property and accepted — got the
// guest menu and could reach no host page, though every host page and route
// would have granted them what the owner gave them. This proves the fix: an
// accepted co_host grant makes them a host, with the sections rolled up from
// what they were granted, while an owner keeps everything and a stranger gets
// nothing. It also proves the query only ever counts an ACTIVE co_host grant,
// so an unaccepted invitation, a revoked grant and a staff row never let anyone
// in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { readWorkSide } = require('../lib/workSide');

// A chainable, awaitable stand-in for a Supabase client — the same Proxy shape
// tests/access.test.ts uses. Each from() gets its own state, so the two
// listings reads (total, and approved via .in('status', …)) don't bleed into
// each other. `calls` keeps the last op list per table so a test can assert how
// a query was filtered.
function client(opts: { listings?: number; approved?: number; coHost?: any[]; provider?: any } = {}) {
    const calls: Record<string, any[]> = {};
    function builder(table: string) {
        const state: any = { ops: [] };
        const chain: any = new Proxy({}, {
            get(_t, prop: string) {
                if (prop === 'maybeSingle') {
                    return async () => ({ data: opts.provider ?? null, error: null });
                }
                if (prop === 'then') {
                    let v: any = { data: [], error: null };
                    if (table === 'listings') {
                        const approvedQuery = state.ops.some((o: any) => o.op === 'in');
                        v = { count: approvedQuery ? (opts.approved ?? 0) : (opts.listings ?? 0), error: null };
                    } else if (table === 'listing_access') {
                        v = { data: opts.coHost ?? [], error: null };
                    }
                    return (resolve: any) => resolve(v);
                }
                return (...args: any[]) => { state.ops.push({ op: prop, args }); calls[table] = state.ops; return chain; };
            },
        });
        return chain;
    }
    return { client: { from: (t: string) => builder(t) }, calls };
}

const grant = (over: Record<string, boolean> = {}) => ({
    can_calendar: false,
    can_messages: false,
    can_bookings: false,
    can_listing: false,
    can_earnings: false,
    ...over,
});

test('a pure co-host is a host, with exactly the sections they were granted', async () => {
    const { client: c } = client({ listings: 0, approved: 0, coHost: [grant({ can_bookings: true, can_messages: true })] });
    const side = await readWorkSide(c, 'sam');

    assert.equal(side.isHost, true, 'shown the switch');
    assert.equal(side.isApprovedHost, true, 'a grant is an owner-approved relationship: defaults onto hosting');
    assert.equal(side.ownsAny, false, 'owns nothing — the owner-only sections stay hidden');
    assert.equal(side.isProvider, false);
    assert.deepEqual(side.hostPerms, grant({ can_bookings: true, can_messages: true }));
});

test('an owner may do everything, and owns a listing', async () => {
    const { client: c } = client({ listings: 2, approved: 2, coHost: [] });
    const side = await readWorkSide(c, 'owner');

    assert.equal(side.isHost, true);
    assert.equal(side.isApprovedHost, true);
    assert.equal(side.ownsAny, true);
    assert.deepEqual(side.hostPerms, grant({ can_calendar: true, can_messages: true, can_bookings: true, can_listing: true, can_earnings: true }));
});

test('an owner of only a draft still owns a listing, but is not yet an approved host', async () => {
    const { client: c } = client({ listings: 1, approved: 0, coHost: [] });
    const side = await readWorkSide(c, 'drafter');

    assert.equal(side.isHost, true);
    assert.equal(side.ownsAny, true, 'owner sections (Reviews, Co-hosts) still theirs on their own listing');
    assert.equal(side.isApprovedHost, false, 'nothing live yet, so no default onto hosting from a cold start');
    assert.deepEqual(side.hostPerms, grant({ can_calendar: true, can_messages: true, can_bookings: true, can_listing: true, can_earnings: true }));
});

test('someone with no listing and no grant is not a host', async () => {
    const { client: c } = client({ listings: 0, approved: 0, coHost: [] });
    const side = await readWorkSide(c, 'guest');

    assert.equal(side.isHost, false);
    assert.equal(side.isApprovedHost, false);
    assert.equal(side.ownsAny, false);
    assert.deepEqual(side.hostPerms, grant());
});

test('a co-host may do a section if they have it on ANY property', async () => {
    // Calendar on one cottage, earnings on another — the menu shows both.
    const { client: c } = client({
        listings: 0,
        approved: 0,
        coHost: [grant({ can_calendar: true }), grant({ can_earnings: true })],
    });
    const side = await readWorkSide(c, 'sam');

    assert.equal(side.hostPerms.can_calendar, true);
    assert.equal(side.hostPerms.can_earnings, true);
    assert.equal(side.hostPerms.can_bookings, false);
    assert.equal(side.hostPerms.can_messages, false);
    assert.equal(side.hostPerms.can_listing, false);
});

test('only an active co_host grant is ever counted — never invited, revoked or staff', async () => {
    // The mock returns whatever rows it is given; this asserts the QUERY asked
    // for status=active and role=co_host, which is what keeps an unaccepted
    // invitation, a revoked grant and a staff row out.
    const { client: c, calls } = client({ listings: 0, approved: 0, coHost: [] });
    await readWorkSide(c, 'sam');

    const eqs = (calls['listing_access'] || []).filter((o: any) => o.op === 'eq').map((o: any) => o.args);
    assert.ok(eqs.some((a: any[]) => a[0] === 'user_id' && a[1] === 'sam'), 'their own rows only');
    assert.ok(eqs.some((a: any[]) => a[0] === 'status' && a[1] === 'active'), 'accepted only');
    assert.ok(eqs.some((a: any[]) => a[0] === 'role' && a[1] === 'co_host'), 'co-hosts, not staff');
});

test('no user id: not a host, nothing granted', async () => {
    const { client: c } = client({});
    const side = await readWorkSide(c, null);

    assert.equal(side.isHost, false);
    assert.equal(side.ownsAny, false);
    assert.deepEqual(side.hostPerms, grant());
});
