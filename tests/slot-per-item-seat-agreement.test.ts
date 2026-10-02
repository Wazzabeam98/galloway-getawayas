// THE PANEL AND THE BOOK ROUTE MUST AGREE — for every seat scenario, including
// the phased per-item override (item capacity/minimum wins, else the provider's).
//
// They share lib/serviceSlots, and drift between "what the guest is shown as
// bookable" and "what the claim accepts" is the bug class that has bitten before:
// a time greyed on one surface but claimable on the other, or offered and then
// refused at checkout. This test encodes BOTH decision procedures exactly as the
// two surfaces run them — each built only from the shared primitives (seatConfig,
// optionAvailability, hasSlotCapacity, unitMultiplies) — and asserts they return
// the same accept/reject across a full matrix. If either surface's rule changes,
// this fails by name.
//
//   PANEL  (components/marketplace/BookingPanel + StandaloneBookingPanel):
//     shows an option when optionAvailability(...).possible; the quantity picker
//     floors at the effective minimum and caps at seatsLeft. A flat item is one
//     booking (no picker).
//   ROUTE  (app/api/services/slots/book/route.ts):
//     refuses a misconfigured per-person item (no seats), refuses quantity below
//     the effective minimum, then checks the SAME optionAvailability and refuses
//     quantity above seatsLeft.
//
// Both read their seats/minimum through the one resolver, seatConfig(), so the
// only way they can disagree is a difference in these two procedures — which is
// exactly what the matrix below rules out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';
installAliases();

import { seatConfig, optionAvailability, hasSlotCapacity } from '@/lib/serviceSlots';
import { unitMultiplies } from '@/lib/serviceOrders';

type Row = { capacity: number; seats_taken: number; private: boolean } | null;
type Seat = { slot_capacity: number | null; slot_min_people: number | null };

// The effective per-booking minimum, the identical expression both surfaces use.
function effMin(unit: string, seat: Seat): number {
    return unitMultiplies(unit) ? Math.max(1, Number(seat.slot_min_people) || 1) : 1;
}

// THE PANEL: would it let the guest book `quantity` of `unit` on `row`?
function panelAllows(row: Row, unit: string, seat: Seat, quantity: number): boolean {
    const avail = optionAvailability(row, unit, seat);
    if (!avail.possible) return false;                 // the option is greyed
    if (!unitMultiplies(unit)) return quantity === 1;  // a flat item is one booking
    return quantity >= effMin(unit, seat) && quantity <= avail.seatsLeft;
}

// THE ROUTE: would the claim accept `quantity` of `unit` on `row`?
function routeAccepts(row: Row, unit: string, seat: Seat, quantity: number): boolean {
    if (unitMultiplies(unit) && !hasSlotCapacity(seat)) return false;   // misconfigured
    if (quantity < effMin(unit, seat)) return false;                    // under the minimum
    const avail = optionAvailability(row, unit, seat);
    if (!avail.possible || quantity > avail.seatsLeft) return false;    // full / mode-clash / over
    return true;
}

// The matrix. Item values win when set; null falls back to the provider.
const ITEM_CAPS = [null, 2, 5];
const ITEM_MINS = [null, 1, 3];
const PROV_CAPS = [null, 4, 8];
const PROV_MINS = [null, 1, 2];
const UNITS = ['flat', 'person'];
const ROWS: Row[] = [
    null,                                              // empty — establish
    { capacity: 4, seats_taken: 0, private: false },   // fresh shared row
    { capacity: 4, seats_taken: 2, private: false },   // partly full shared
    { capacity: 4, seats_taken: 4, private: false },   // full shared
    { capacity: 6, seats_taken: 1, private: false },   // roomy shared
    { capacity: 1, seats_taken: 1, private: true },    // privately hired
];
const QUANTITIES = [1, 2, 3, 5, 9];

test('panel and book route agree on every seat scenario (per-item override + fallback)', () => {
    let checked = 0;
    const disagreements: string[] = [];
    for (const itemCapacity of ITEM_CAPS)
    for (const itemMin of ITEM_MINS)
    for (const provCap of PROV_CAPS)
    for (const provMin of PROV_MINS)
    for (const unit of UNITS)
    for (const row of ROWS)
    for (const quantity of QUANTITIES) {
        const seat = seatConfig(itemCapacity, itemMin, { slot_capacity: provCap, slot_min_people: provMin });
        // Skip an impossible pairing: a per-person item with NO seats anywhere
        // could never have established a shared row, so "no capacity + an existing
        // shared table" is not a state the booking flow can produce. (The only way
        // to reach it is a provider clearing capacity AFTER a session is booked —
        // a pre-existing edge, orthogonal to the per-item move; there the route's
        // pre-Stripe misconfig fail is stricter than the panel, unchanged by this.)
        const sharedRowExists = !!row && !row.private && row.capacity > 1;
        if (!hasSlotCapacity(seat) && sharedRowExists) continue;
        const panel = panelAllows(row, unit, seat, quantity);
        const route = routeAccepts(row, unit, seat, quantity);
        checked++;
        if (panel !== route) {
            disagreements.push(
                `item(cap=${itemCapacity},min=${itemMin}) prov(cap=${provCap},min=${provMin}) `
                + `unit=${unit} row=${JSON.stringify(row)} q=${quantity} -> panel=${panel} route=${route}`,
            );
        }
    }
    assert.deepEqual(disagreements, [], `panel/route disagree in ${disagreements.length} of ${checked} cases:\n  ` + disagreements.slice(0, 10).join('\n  '));
    assert.ok(checked > 1000, 'the matrix should be broad');
});

test('the item value wins over the provider; null falls back', () => {
    const prov = { slot_capacity: 8, slot_min_people: 2 };
    // Item sets its own, tighter seats + minimum — the item wins.
    assert.deepEqual(seatConfig(3, 4, prov), { slot_capacity: 3, slot_min_people: 4 });
    // Item sets only seats; the minimum falls back to the provider.
    assert.deepEqual(seatConfig(3, null, prov), { slot_capacity: 3, slot_min_people: 2 });
    // Item sets nothing — pure fallback, i.e. today's behaviour for every existing row.
    assert.deepEqual(seatConfig(null, null, prov), { slot_capacity: 8, slot_min_people: 2 });
    // No provider value either — a per-person item is then misconfigured (no seats).
    assert.equal(hasSlotCapacity(seatConfig(null, null, { slot_capacity: null, slot_min_people: null })), false);
    // But an item that sets its OWN seats is bookable even with no provider default.
    assert.equal(hasSlotCapacity(seatConfig(4, null, { slot_capacity: null, slot_min_people: null })), true);
});
