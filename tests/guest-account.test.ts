// The identity rule for minting a guest account after payment.
//
// The one that matters most: the SAME email booking twice lands on ONE profile,
// never two. The rest guard the squatting edge — a stranger's address typed into
// the form must never graft an order onto their account.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveGuestForPaidOrder, normaliseEmail, type GuestStore } from '../lib/guestAccount';

// A fake store: an in-memory email -> id map, counting how many accounts were
// actually minted so a test can prove a repeat booking created none.
function fakeStore(seed: Record<string, string> = {}) {
    const byEmail = new Map<string, string>(Object.entries(seed).map(([e, id]) => [e.toLowerCase(), id]));
    let created = 0;
    let nextId = 1;
    const store: GuestStore = {
        async findIdByEmail(email: string) {
            return byEmail.get(email.toLowerCase()) || null;
        },
        async createGuest(email: string) {
            created++;
            const id = 'minted-' + (nextId++);
            byEmail.set(email.toLowerCase(), id);
            return id;
        },
    };
    return { store, byEmail, mints: () => created };
}

test('normaliseEmail lowercases and trims', () => {
    assert.equal(normaliseEmail('  Jo@Example.COM '), 'jo@example.com');
    assert.equal(normaliseEmail(null), '');
    assert.equal(normaliseEmail(undefined), '');
});

test('the same email booking twice lands on ONE profile', async () => {
    const { store, mints } = fakeStore();

    // First booking: brand-new guest, pays with the address they typed.
    const first = await resolveGuestForPaidOrder(store, {
        typedEmail: 'guest@example.com',
        payerEmail: 'guest@example.com',
        name: 'A Guest',
    });
    assert.equal(first.created, true, 'first booking mints the account');

    // Second booking, later: same address, same card.
    const second = await resolveGuestForPaidOrder(store, {
        typedEmail: 'guest@example.com',
        payerEmail: 'guest@example.com',
        name: 'A Guest',
    });

    assert.equal(second.created, false, 'the second booking reuses, never mints');
    assert.equal(second.id, first.id, 'both orders land on the same profile id');
    assert.equal(mints(), 1, 'exactly one account was ever created');
});

test('case and whitespace differences still resolve to one profile', async () => {
    const { store, mints } = fakeStore();
    const a = await resolveGuestForPaidOrder(store, { typedEmail: 'Guest@Example.com', payerEmail: 'Guest@Example.com' });
    const b = await resolveGuestForPaidOrder(store, { typedEmail: '  guest@example.COM ', payerEmail: 'guest@example.com' });
    assert.equal(b.id, a.id);
    assert.equal(mints(), 1);
});

test('a returning guest with an existing account is reused, not re-created', async () => {
    const { store, mints } = fakeStore({ 'returning@example.com': 'existing-99' });
    const r = await resolveGuestForPaidOrder(store, {
        typedEmail: 'returning@example.com',
        payerEmail: 'returning@example.com',
    });
    assert.equal(r.id, 'existing-99');
    assert.equal(r.created, false);
    assert.equal(mints(), 0);
});

test('a stranger’s address typed in, paid from another card, never attaches to their account', async () => {
    // stranger@ already has an account. The booker typed it (by mistake or
    // malice) but paid from their own address.
    const { store, byEmail, mints } = fakeStore({ 'stranger@example.com': 'stranger-1' });

    const r = await resolveGuestForPaidOrder(store, {
        typedEmail: 'stranger@example.com',
        payerEmail: 'booker@example.com',
        name: 'The Booker',
    });

    assert.notEqual(r.id, 'stranger-1', 'must NOT hijack the stranger’s account');
    assert.equal(r.created, true, 'a fresh account is minted instead');
    assert.equal(r.email, 'booker@example.com', 'keyed on the proven payer address');
    assert.equal(byEmail.get('stranger@example.com'), 'stranger-1', 'the stranger’s account is untouched');
    assert.equal(mints(), 1);
});

test('typed email differs from payer, payer already has an account → reuse the proven payer account', async () => {
    const { store, mints } = fakeStore({ 'payer@example.com': 'payer-7' });
    const r = await resolveGuestForPaidOrder(store, {
        typedEmail: 'typo@example.com',
        payerEmail: 'payer@example.com',
    });
    assert.equal(r.id, 'payer-7', 'the proven payer account wins');
    assert.equal(r.created, false);
    assert.equal(mints(), 0);
});

test('a free typed address is used even when it differs from the payer', async () => {
    // Neither address has an account; the guest typed a contact address and paid
    // from a different one. We use what they typed — nobody to hijack.
    const { store } = fakeStore();
    const r = await resolveGuestForPaidOrder(store, {
        typedEmail: 'contact@example.com',
        payerEmail: 'wallet@example.com',
    });
    assert.equal(r.created, true);
    assert.equal(r.email, 'contact@example.com');
});

test('no payer address falls back to the typed address', async () => {
    const { store } = fakeStore();
    const r = await resolveGuestForPaidOrder(store, { typedEmail: 'only@example.com', payerEmail: null });
    assert.equal(r.created, true);
    assert.equal(r.email, 'only@example.com');
});

test('no email at all throws rather than minting a nameless account', async () => {
    const { store } = fakeStore();
    await assert.rejects(
        () => resolveGuestForPaidOrder(store, { typedEmail: null, payerEmail: null }),
        /no email/
    );
});
