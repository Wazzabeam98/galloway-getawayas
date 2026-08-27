// Extras, and the money rule that decides how each type behaves.
//
// Three types, because they are three different things:
//
//   toggle      matching and comparison. Never a line on a bill.
//   priced      part of the ceiling the 10% comes off.
//   reimbursed  the provider spends the host's money and is paid back directly
//               against a receipt. Off Stripe entirely. No number exists at
//               quote time, it is revenue for nobody, and it must never reach
//               a ceiling or a commission.
//
// That last rule is the one worth the most tests. It is the same shape as
// typical_hours: a value that must stay out of every total, guarded twice —
// once by behaviour and once by reading the source, because behaviour can only
// cover the code that exists today.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    SERVICE_EXTRAS,
    extrasFor,
    extraByKey,
    extrasProblems,
    groupIsOffered,
    groupGate,
    offeringsFor,
    isPricingGroup,
    EXTRA_GROUPS,
    submitProblems,
    HOST_TRADES,
    TRADE_GROUPS,
} = require('@/lib/serviceProviders');

const { serviceCeiling, serviceCommission } = require('@/lib/pricing');

const cleaning = () => extrasFor('sponge');

// --- the catalogue ---------------------------------------------------------

test('every extra belongs to a real trade and has a type', () => {
    for (const e of SERVICE_EXTRAS) {
        assert.equal(HOST_TRADES.indexOf(e.trade) !== -1, true, e.key + ' is on no host trade');
        assert.equal(['toggle', 'priced', 'reimbursed'].indexOf(e.type) !== -1, true, e.key + ' has no type');
        assert.equal(EXTRA_GROUPS.some((g: any) => g.key === e.group), true, e.key + ' is in no known group');
        assert.ok(e.label && e.label.length > 3, e.key + ' has no label');
    }
});

test('no two extras share a key', () => {
    const keys = SERVICE_EXTRAS.map((e: any) => e.key);
    assert.equal(new Set(keys).size, keys.length);
});

test('a per-unit extra says what the host is counting', () => {
    for (const e of SERVICE_EXTRAS) {
        if (e.unit === 'each') {
            assert.ok(e.quantityLabel, e.key + ' is per-unit but never says per what');
        }
    }
});

test('cleaning carries the extras that were asked for', () => {
    const keys = cleaning().map((e: any) => e.key);

    for (const expected of [
        'equipment_provided', 'damage_photos',
        'bedding_single', 'bedding_double', 'bedding_king', 'hot_tub_service',
        'consumables', 'welcome_gifts', 'receipts_provided',
    ]) {
        assert.equal(keys.indexOf(expected) !== -1, true, expected + ' is missing');
    }

    assert.equal(keys.some((k: string) => /pet/.test(k)), false, 'the pet surcharge was dropped');
    assert.equal(keys.indexOf('laundry_on_site'), -1, 'the two laundry toggles were dropped');
    assert.equal(keys.indexOf('laundry_taken_away'), -1);
    assert.equal(keys.indexOf('same_day_changeover'), -1, 'and the same-day changeover toggle');
});

test('the three bedding rates sit behind one question', () => {
    const beds = cleaning().filter((e: any) => e.group === 'laundry');

    assert.deepEqual(beds.map((e: any) => e.key), ['bedding_single', 'bedding_double', 'bedding_king']);
    assert.equal(groupGate('laundry'), 'Do you offer a laundry service?');

    for (const b of beds) {
        assert.equal(b.type, 'priced');
        assert.equal(b.unit, 'each', b.key + ' is a rate per bed, not a total');
    }
});

test('king is a catalogue entry and needs no column', () => {
    const king = extraByKey('bedding_king');

    assert.equal(king.group, 'laundry');
    assert.equal(king.type, 'priced');
    // The table constrains the shape of a key, not a list of them — which is
    // why a new size is a line in lib rather than a migration.
    assert.match(king.key, /^[a-z][a-z0-9_]{2,48}$/);
});

test('the gate is worked out from the prices, never stored', () => {
    const trade = 'sponge';

    assert.equal(groupIsOffered('laundry', trade, {}), false);
    assert.equal(groupIsOffered('laundry', trade, { bedding_double: { price: '' } }), false,
        'a blank box is not an offer');
    assert.equal(groupIsOffered('laundry', trade, { bedding_double: { price: '0' } }), false);
    assert.equal(groupIsOffered('laundry', trade, { bedding_double: { price: '8' } }), true,
        'one rate filled in is a laundry service');
    assert.equal(groupIsOffered('laundry', trade, { bedding_king: { price: '12' } }), true);
});

test('only groups that need a question have one', () => {
    assert.equal(groupGate('priced'), null);
    assert.equal(groupGate('about'), null);
    assert.equal(groupGate('reimbursed'), null);
});

test('receipts sits with the reimbursed ones but is stored as a toggle', () => {
    const receipts = extraByKey('receipts_provided');
    assert.equal(receipts.type, 'toggle', 'there is no price on it');
    assert.equal(receipts.group, 'reimbursed', 'but it belongs with the money it is about');
});

test('a trade with no extras yet has none rather than the cleaning ones', () => {
    assert.deepEqual(extrasFor('trees'), []);
    assert.deepEqual(extrasFor('bin'), []);
});

test('window cleaning offers exactly the shapes the trade is being asked about', () => {
    const keys = extrasFor('droplet').map((e: any) => e.key);

    // Long poles: going upstairs is not a real distinction, so height is
    // priced rather than offered or withheld.
    assert.deepEqual(keys, [
        'pressure_washing', 'gutter_cleaning', 'fascias_soffits', 'solar_panels',
        'callout_base', 'pane_rate',
        'pane_ground', 'pane_first', 'pane_second_plus',
    ]);
    assert.equal(extraByKey('upstairs_windows'), null);
});

test('each extra service is asked, then priced, on its own', () => {
    // Same shape as the laundry gate: a question, then one price. Each has its
    // own group so switching one on does not reveal the other three.
    const pairs = [
        ['pressure_washing', 'svc_pressure'],
        ['gutter_cleaning', 'svc_gutter'],
        ['fascias_soffits', 'svc_fascias'],
        ['solar_panels', 'svc_solar'],
    ];

    for (const [key, group] of pairs) {
        const extra = extraByKey(key);
        assert.equal(extra.trade, 'droplet');
        assert.equal(extra.type, 'priced', key + ' takes a price now');
        assert.equal(extra.group, group, key + ' has a gate of its own');
        assert.ok(groupGate(group), group + ' needs a question in front of it');
    }

    // One group each, so they cannot reveal one another.
    assert.equal(new Set(pairs.map((p) => p[1])).size, 4);
});

test('the three pricing structures are all on the page at once', () => {
    const shapes = {
        pane_flat: ['callout_base', 'pane_rate'],
        pane_storey: ['pane_ground', 'pane_first', 'pane_second_plus'],
    };

    for (const group of Object.keys(shapes)) {
        const keys = extrasFor('droplet').filter((e: any) => e.group === group).map((e: any) => e.key);
        assert.deepEqual(keys, (shapes as any)[group]);
        assert.equal(isPricingGroup(group), true, group + ' is a way of pricing, not a thing offered');
        assert.equal(groupGate(group), null, 'nothing is hidden behind a toggle — they are all visible');
    }

    // Three shapes, not four: quote-per-job is gone, so a window cleaner is
    // choosing between ways of pricing rather than whether to price at all.
    assert.equal(extraByKey('quote_per_job'), null);
});

test('a pricing structure is never summed as if it were an extra', () => {
    // The trap: the structures are priced rows too, so a ceiling built from
    // the whole catalogue would add a per-pane rate to a band price and to
    // every other structure at once. Ceilings are built from offeringsFor,
    // which leaves them out.
    const offered = offeringsFor('droplet').map((e: any) => e.key);

    for (const key of ['callout_base', 'pane_rate', 'pane_ground', 'pane_first', 'pane_second_plus', 'quote_per_job']) {
        assert.equal(offered.indexOf(key), -1, key + ' must not be offered as an extra');
    }

    const ceiling = serviceCeiling(
        {
            bandPrice: 35,
            extras: {
                pane_rate: { offered: true, price: 2.5, quantity: 40 },
                callout_base: { offered: true, price: 20 },
                gutter_cleaning: { offered: true, price: 60 },
            },
        },
        offeringsFor('droplet')
    );

    assert.equal(ceiling, 95, 'the band plus the gutter clean — not the per-pane rate as well');
});

test('there is no fifth way to price height', () => {
    // A flat surcharge on top of the bands was one shape too many next to the
    // four the trade is choosing between, and height is what the
    // per-pane-by-storey shape is for.
    assert.equal(extraByKey('upstairs_surcharge'), null);
    assert.equal(extraByKey('high_access_surcharge'), null);
    assert.deepEqual(extrasFor('droplet').filter((e: any) => e.group === 'priced'), []);
});


// --- what has to be filled in ----------------------------------------------

const offered = (extras: Record<string, any>) => ({ trade: 'sponge', extras });

test('offering nothing is fine', () => {
    assert.deepEqual(extrasProblems(offered({})), []);
});

test('a blank price is a real answer, not a mistake', () => {
    assert.deepEqual(extrasProblems(offered({ hot_tub_service: { price: '' } })), [],
        'a price is the yes and a blank is the no, exactly as the size bands work');
    assert.deepEqual(extrasProblems(offered({ bedding_king: { price: '' } })), []);
});

test('something typed into a price box that is not a price is caught', () => {
    const problems = extrasProblems(offered({ hot_tub_service: { price: 'twenty' } }));
    assert.equal(problems.length, 1);
    assert.equal(problems[0].field, 'extra_price_hot_tub_service');

    assert.equal(
        extrasProblems(offered({ bedding_single: { price: '-4' } }))
            .some((p: any) => p.field === 'extra_price_bedding_single'),
        true
    );
});

test('a priced extra has no tick to disagree with its price', () => {
    // The price alone decides. Offering nothing and offering a blank are the
    // same answer, and there is no state where a tick says yes and the box
    // says nothing.
    assert.deepEqual(
        extrasProblems(offered({ hot_tub_service: { price: '25' } })),
        extrasProblems(offered({ hot_tub_service: { offered: true, price: '25' } }))
    );
});

test('a toggle never needs a price', () => {
    assert.deepEqual(extrasProblems(offered({ damage_photos: { offered: true } })), []);
});

test('a reimbursed extra never needs a price — there is no number yet', () => {
    assert.deepEqual(extrasProblems(offered({ consumables: { offered: true } })), [],
        'the amount is whatever the receipt says, weeks later');
});

test('extras are part of the one submit gate', () => {
    const base = {
        business_name: 'Solway Sparkle',
        trade: 'sponge',
        description: 'Changeover cleans and deep cleans for holiday cottages across the Stewartry.',
        contact_email: 'hello@solwaysparkle.test',
        // Supplied the way the page supplies it — derived from the trade.
        audience: 'host',
        areaCount: 1,
        prices: { beds_1_2: { price: '60' } },
    };

    assert.deepEqual(submitProblems(base), []);
    assert.equal(
        submitProblems({ ...base, extras: { bedding_double: { price: 'eight' } } })
            .some((p: any) => p.field === 'extra_price_bedding_double'),
        true
    );
});

// --- the ceiling -----------------------------------------------------------

test('the ceiling is the band price when nothing is added', () => {
    assert.equal(serviceCeiling({ bandPrice: '60' }, cleaning()), 60);
});

test('a flat priced extra is added to the ceiling', () => {
    const ceiling = serviceCeiling(
        { bandPrice: 60, extras: { hot_tub_service: { offered: true, price: 25 } } },
        cleaning()
    );
    assert.equal(ceiling, 85);
});

test('a per-unit extra multiplies by what the host asked for', () => {
    const ceiling = serviceCeiling(
        {
            bandPrice: 60,
            extras: {
                bedding_double: { offered: true, price: 8, quantity: 3 },
                bedding_single: { offered: true, price: 5, quantity: 2 },
                bedding_king: { offered: true, price: 12, quantity: 1 },
            },
        },
        cleaning()
    );
    assert.equal(ceiling, 60 + 24 + 10 + 12);
});

test('a per-unit extra with no quantity adds nothing', () => {
    const ceiling = serviceCeiling(
        { bandPrice: 60, extras: { bedding_double: { offered: true, price: 8 } } },
        cleaning()
    );
    assert.equal(ceiling, 60, 'no beds asked for is no beds charged');
});

test('an extra that was not offered is not charged even with a price on it', () => {
    const ceiling = serviceCeiling(
        { bandPrice: 60, extras: { hot_tub_service: { offered: false, price: 25 } } },
        cleaning()
    );
    assert.equal(ceiling, 60);
});

test('the ceiling lands on a penny', () => {
    const ceiling = serviceCeiling(
        { bandPrice: 60.005, extras: { hot_tub_service: { offered: true, price: 0.001 } } },
        cleaning()
    );
    assert.equal(ceiling, Math.round(ceiling * 100) / 100);
});

test('commission is ten per cent of the ceiling', () => {
    assert.equal(serviceCommission(85, 0.10), 8.5);
    assert.equal(serviceCommission(0, 0.10), 0);
    assert.equal(serviceCommission(33.33, 0.10), 3.33);
});

// --- reimbursed money never reaches a total --------------------------------

test('a reimbursed extra never enters the ceiling', () => {
    const without = serviceCeiling({ bandPrice: 60 }, cleaning());

    // Offered, and with a price wrongly attached — the sort of thing a bad
    // write or a hand-edited row could produce.
    const withReimbursed = serviceCeiling(
        {
            bandPrice: 60,
            extras: {
                consumables: { offered: true, price: 40, quantity: 3 },
                welcome_gifts: { offered: true, price: 25 },
            },
        },
        cleaning()
    );

    assert.equal(withReimbursed, without,
        'the host pays the cleaner back directly — it is revenue for nobody and cannot be commissioned');
});

test('a reimbursed extra never changes the commission', () => {
    const clean = serviceCommission(serviceCeiling({ bandPrice: 60 }, cleaning()), 0.10);
    const dirty = serviceCommission(
        serviceCeiling(
            { bandPrice: 60, extras: { consumables: { offered: true, price: 400 } } },
            cleaning()
        ),
        0.10
    );

    assert.equal(dirty, clean);
    assert.equal(dirty, 6);
});

test('reimbursed money is absent by construction, not by subtraction', () => {
    // Structural half. Only 'priced' is summed, so there is no branch that
    // could let a reimbursed extra through — and no line that touches the word
    // may multiply or divide.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'lib', 'pricing.ts'), 'utf8');

    const offending = src
        .split('\n')
        .map((line: string) => line.replace(/\/\/.*$/, ''))
        .filter((line: string) => /reimburse/i.test(line))
        .filter((line: string) => /[*\/]/.test(line));

    assert.deepEqual(offending, [],
        'a reimbursed amount must never be a term in a total');

    // And the sum is opt-in on the type, rather than opting reimbursed out —
    // a filter that excludes is one edit away from including.
    assert.match(src, /extra\.type !== 'priced'\) continue;/,
        'only priced extras are summed, by name');
});

// ---------------------------------------------------------------------------
// The three axes on the maintenance trades.
//
// A host with a problem searches for the problem. Before this, the faults were
// grey subtitles under headings like "I take emergency call-outs", so somebody
// looking for a leak found nothing — the list described what kind of plumber
// somebody was rather than what had gone wrong.
// ---------------------------------------------------------------------------

// Taken from TRADE_GROUPS rather than typed out, because a typed-out list
// silently stops covering a trade the moment one is added to the group. This
// was five names with `painter` missing, so the painter was never checked by
// any of the loops below — and it was the one trade that had drifted.
const MAINTENANCE: string[] = TRADE_GROUPS
    .filter((g: any) => g.key === 'maintenance')
    .flatMap((g: any) => g.trades as string[]);

// The painter has no faults list, on purpose — see the test below. Everything
// else about a maintenance trade applies to the painter too.
const WITH_FAULTS = MAINTENANCE.filter((t) => t !== 'painter');

test('every maintenance trade separates faults from planned work', () => {
    for (const trade of WITH_FAULTS) {
        const groups = extrasFor(trade).map((e: any) => e.group);

        assert.equal(groups.indexOf('faults') !== -1, true, trade + ' has a faults list');
        assert.equal(groups.indexOf('planned') !== -1, true, trade + ' has a planned list');
        assert.equal(groups.indexOf('availability') !== -1, true, trade + ' says when it turns out');
    }
});

// The two axes that are not about something having gone wrong. The painter is
// in here: having no faults list is a reason to skip the faults assertion, not
// a reason to go unchecked entirely, which is what the hardcoded list did.
test('every maintenance trade says what it does and when it turns out', () => {
    for (const trade of MAINTENANCE) {
        const groups = extrasFor(trade).map((e: any) => e.group);

        assert.equal(groups.indexOf('planned') !== -1, true,
            trade + ' files what it does under a heading a host can read');
        assert.equal(groups.indexOf('availability') !== -1, true, trade + ' says when it turns out');
    }
});

// Deliberate, not an omission. Painting is almost never a fault, and inventing
// urgent-sounding entries to fill a column would be dressing up a scuffed wall
// as a leak.
test('the painter has no faults list, on purpose', () => {
    const groups = extrasFor('painter').map((e: any) => e.group);

    assert.equal(groups.indexOf('faults'), -1, 'a scuffed wall is not an emergency');
    assert.equal(groups.indexOf('availability') !== -1, true, 'but how fast they get in still matters');
});

test('a blocked toilet is not filed with the outside drains', () => {
    const faults = extrasFor('plumber')
        .filter((e: any) => e.group === 'faults')
        .map((e: any) => e.key);

    // The guests who blocked it are still in the cottage. A blocked gully is
    // next week. Merging them loses the only distinction that matters.
    assert.equal(faults.indexOf('plumb_blocked_toilet') !== -1, true);
    assert.equal(faults.indexOf('plumb_drains') !== -1, true);
    assert.notEqual('plumb_blocked_toilet', 'plumb_drains');
});

test('the trades that serve empty cottages in winter say so', () => {
    // An empty property is the one that gets hurt: no heating tonight means
    // frozen pipes by morning, and nobody is there to notice.
    for (const trade of ['plumber', 'roofer', 'electrician']) {
        const winter = extrasFor(trade).filter((e: any) => e.key.indexOf('_winter') !== -1);
        assert.equal(winter.length, 1, trade + ' offers a winter turnout');
        assert.equal(winter[0].group, 'availability');
    }
});

test('what a host searches for is a heading, never only a hint', () => {
    // The bug this replaced: "leaks and no heating" existed only in the grey
    // line under "I take emergency call-outs". Every fault is its own entry
    // with its own label, so nothing a host would search for is buried.
    for (const trade of MAINTENANCE) {
        for (const extra of extrasFor(trade).filter((e: any) => e.group === 'faults')) {
            assert.equal(typeof extra.label === 'string' && extra.label.length > 0, true,
                extra.key + ' has a label of its own');
        }
    }
});
