// A companion sees the experience, never its price — and the exclusion is a
// wall, not a curtain. The cottage side taught this: /api/trips strips the money
// before it leaves the server, so a hidden element in the page can't be the whole
// story. This holds the experience order loader to the same standard.
//
// The loader reads the order twice: once for the SAFE columns (no money field is
// even named), and — only for the booker — a second time for the price. An
// accepted companion's path never issues the price query and the order it hands
// back is money-stripped, so no amount can reach that viewer's payload.
//
// PROVE IT FAILS FIRST: make loadExperienceOrder fetch the price regardless of
// role (drop the `role === 'booker'` guard), or stop stripping the order, and the
// companion assertions below go red on the amount.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './helpers/stub';
import {
    loadExperienceOrder,
    orderColumns,
    stripMoney,
    ORDER_MONEY_COLUMNS,
} from '../lib/experienceOrder';

const PRICE = 40;

const REFUNDED = 10;

// service_orders answers the SAFE query with a money-free row, and the money
// query (which names price and amount_refunded) with the amounts — exactly as
// PostgREST would, so the only way a companion sees the price is if the loader
// wrongly issues the second query for them.
function orderHandlers(bookerId: string, seatRow: any) {
    return {
        service_orders: (state: any) => {
            const sel = state.ops.find((o: any) => o.op === 'select');
            const cols = (sel && sel.args && sel.args[0]) || '';
            if (cols.includes('price')) return { data: { price: PRICE, amount_refunded: REFUNDED }, error: null };
            return { data: { id: 'o1', guest_id: bookerId, shape: 'slot', attendees: 2, item_name: 'Private sauna hour' }, error: null };
        },
        booking_guests: { data: seatRow, error: null },
    };
}

test('an accepted companion’s order payload carries no price', async () => {
    // The viewer is NOT the booker, but holds an accepted seat on the order.
    const { client } = fakeSupabase(orderHandlers('BOOKER', { id: 'seat1' }));

    const loaded = await loadExperienceOrder(client as any, 'o1', 'COMPANION');

    assert.equal(loaded.role, 'companion', 'an accepted seat makes them a companion');
    assert.equal(loaded.price, null, 'a companion is handed no price (the wall returns null, not the amount)');

    // The amount appears NOWHERE in the payload the page renders from.
    assert.equal(JSON.stringify(loaded).includes(String(PRICE)), false, 'the amount must appear nowhere in a companion’s payload');
    // And the order object itself carries no money field of any name — so nothing
    // downstream can read a price off it.
    for (const key of ORDER_MONEY_COLUMNS) {
        assert.equal(key in (loaded.order as object), false, `the order object must carry no ${key}`);
    }
});

test('the booker DOES get the price — the wall is role-based, not a blanket removal', async () => {
    const { client } = fakeSupabase(orderHandlers('BOOKER', null));

    const loaded = await loadExperienceOrder(client as any, 'o1', 'BOOKER');

    assert.equal(loaded.role, 'booker');
    assert.equal(loaded.price, PRICE, 'the booker sees what they paid');
    assert.equal(loaded.amountRefunded, REFUNDED, 'the booker also sees what was refunded (net paid = price − refunded)');
});

test('someone who is neither booker nor accepted companion is refused (order null)', async () => {
    const { client } = fakeSupabase(orderHandlers('BOOKER', null)); // no seat

    const loaded = await loadExperienceOrder(client as any, 'o1', 'STRANGER');

    assert.equal(loaded.role, null, 'no role');
    assert.equal(loaded.order, null, 'no order handed back — the caller redirects');
});

test('the companion column list cannot even name a money field', () => {
    const companionCols = orderColumns(false);
    for (const key of ORDER_MONEY_COLUMNS) {
        assert.equal(companionCols.includes(key), false, `companion select must not name ${key}`);
    }
    assert.equal(orderColumns(true).includes('price'), true, 'the booker select does name price');
});

test('stripMoney removes every money key even from a row that carried one', () => {
    const stripped = stripMoney({ id: 'o1', item_name: 'Sauna', price: PRICE, unit_price: PRICE, commission_rate: 0.1, amount_refunded: 0 });
    for (const key of ORDER_MONEY_COLUMNS) {
        assert.equal(key in stripped, false, `${key} must be gone`);
    }
    assert.equal((stripped as any).item_name, 'Sauna', 'non-money fields survive');
});
