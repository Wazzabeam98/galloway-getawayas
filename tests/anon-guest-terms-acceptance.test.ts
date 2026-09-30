// An anonymous booker's GUEST TERMS acceptance survives the gap between ticking
// the box at checkout (no account yet) and the account being minted from the
// Stripe payer email after payment.
//
// The tick rides on the order (service_orders.guest_terms_version /
// guest_terms_accepted_at); the moment the account is minted the acceptance is
// written against it — with the version and the CHECKOUT time they ticked, never
// the later account-creation time. If the account is never minted the fact stays
// on the order. These tests lock in both halves: the low-level record helper, and
// the request/cart path (createRequestOrderFromSession) that mints then records.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases, stubModule, fakeSupabase } from './helpers/stub';

installAliases();

stubModule('@/lib/email', {
    sendEmail: async () => {},
    emailLayout: () => '',
    escapeHtml: (s: any) => String(s),
    button: () => '',
    noteCallout: () => '',
    allergyCallout: () => '',
    formatDate: (s: any) => String(s),
    NEUTRAL_SUBTITLE: '',
    SITE_URL: 'http://example.invalid',
});
stubModule('@/lib/stripe', { stripeRequest: async () => ({}) });
stubModule('@/lib/logError', { logError: async () => {} });
stubModule('@/lib/supabaseAdmin', { adminClient: () => ({}) });

const { recordOrderGuestTerms } = require('@/lib/agreementRecords');
const { AGREEMENTS } = require('@/lib/agreements');
const { createRequestOrderFromSession } = require('@/lib/requestOrder');

// A fake admin that captures the agreement_acceptances upsert.
function acceptanceAdmin() {
    const captured: any = { acceptance: null };
    const fake = fakeSupabase({
        agreement_acceptances: (state: any) => {
            const up = state.ops.find((o: any) => o.op === 'upsert');
            if (up) captured.acceptance = up.args[0];
            return { data: null, error: null };
        },
    });
    return { admin: fake.client as any, captured };
}

test('recordOrderGuestTerms records the carried version and tick time, not now', async () => {
    const { admin, captured } = acceptanceAdmin();
    const tickedAt = '2026-01-02T03:04:05.000Z';   // long before "now"

    const { error } = await recordOrderGuestTerms(admin, 'user-1', {
        guest_terms_version: 'v1-draft-2026-09-29',
        guest_terms_accepted_at: tickedAt,
    });

    assert.equal(error, null);
    assert.ok(captured.acceptance, 'an acceptance row was written');
    assert.equal(captured.acceptance.user_id, 'user-1');
    assert.equal(captured.acceptance.document, 'guest');
    assert.equal(captured.acceptance.version, 'v1-draft-2026-09-29', 'the version the guest ticked');
    assert.equal(captured.acceptance.accepted_at, tickedAt, 'the checkout tick time, not now');
    assert.equal(captured.acceptance.source, 'experience_checkout_anon');
});

test('recordOrderGuestTerms is a no-op for a signed-in order (no carried version)', async () => {
    const { admin, captured } = acceptanceAdmin();
    const { error } = await recordOrderGuestTerms(admin, 'user-1', { guest_terms_version: null, guest_terms_accepted_at: null });
    assert.equal(error, null);
    assert.equal(captured.acceptance, null, 'nothing is written when there is no acceptance to carry');
});

test('recordOrderGuestTerms is a no-op when no account was minted', async () => {
    const { admin, captured } = acceptanceAdmin();
    const { error } = await recordOrderGuestTerms(admin, null, {
        guest_terms_version: 'v1-draft-2026-09-29',
        guest_terms_accepted_at: '2026-01-02T03:04:05.000Z',
    });
    assert.equal(error, null);
    assert.equal(captured.acceptance, null, 'without an account, the fact stays on the order only');
});

// A signed-out standalone cart carrying the Guest Terms acceptance mints a guest,
// writes the columns on the order, AND records the acceptance against the minted
// account with the carried tick time.
function requestOrderAdmin() {
    const captured: any = { insert: null, acceptance: null, createUser: 0 };
    const fake = fakeSupabase({
        service_orders: (state: any) => {
            const ins = state.ops.find((o: any) => o.op === 'insert');
            if (ins) { captured.insert = ins.args[0]; return { data: { id: 'order-1' }, error: null }; }
            return { data: null, error: null };
        },
        service_providers: { data: { id: 'prov-1', business_name: 'Galloway Bakehouse', trade: 'baker', shape: 'made_to_order', contact_email: 'prov@example.com', exclusive_per_date: false }, error: null },
        service_provider_items: { data: [{ id: 'it-1', name: 'Sourdough', unit: 'each', price: 5, is_custom: false }], error: null },
        profiles: (state: any) => {
            const up = state.ops.find((o: any) => o.op === 'upsert');
            if (up) return { data: null, error: null };
            const lim = state.ops.find((o: any) => o.op === 'limit');
            if (lim) return { data: [], error: null };   // findIdByEmail: none → mint
            return { data: null, error: null };
        },
        agreement_acceptances: (state: any) => {
            const up = state.ops.find((o: any) => o.op === 'upsert');
            if (up) captured.acceptance = up.args[0];
            return { data: null, error: null };
        },
    });
    const admin: any = fake.client;
    admin.auth = { admin: { createUser: async () => { captured.createUser++; return { data: { user: { id: 'minted-guest-id' } }, error: null }; } } };
    return { admin, captured };
}

test('a signed-out standalone order records the Guest Terms against the minted account', async () => {
    const { admin, captured } = requestOrderAdmin();
    const tickedAt = '2026-06-01T09:00:00.000Z';

    const session = {
        metadata: {
            kind: 'service_order', provider_id: 'prov-1', booking_id: '', guest_id: '',
            listing_id: '', service_date: '2099-06-01', service_time: '', fulfilment: 'collection',
            standalone: '1', contact_name: 'A Guest', contact_email: 'guest@example.com', contact_phone: '',
            instant: '1', cart: 'it-1:2', commission_rate: '0.10', item_unit: 'order', item_name: 'Order',
            guest_terms_version: AGREEMENTS.guest.version,
            guest_terms_accepted_at: tickedAt,
        },
        payment_intent: 'pi_test_1',
        amount_total: 1000,
        customer_details: { email: 'guest@example.com' },
    };

    const res = await createRequestOrderFromSession(admin, session);

    assert.equal(res.created, true);
    assert.equal(captured.createUser, 1, 'a guest account was minted');
    assert.ok(captured.insert, 'a service_orders row was inserted');
    assert.equal(captured.insert.guest_terms_version, AGREEMENTS.guest.version, 'the order keeps the version the guest ticked');
    assert.equal(captured.insert.guest_terms_accepted_at, tickedAt, 'the order keeps the tick time');
    assert.ok(captured.acceptance, 'the acceptance was recorded against the minted account');
    assert.equal(captured.acceptance.user_id, 'minted-guest-id');
    assert.equal(captured.acceptance.document, 'guest');
    assert.equal(captured.acceptance.version, AGREEMENTS.guest.version);
    assert.equal(captured.acceptance.accepted_at, tickedAt, 'recorded at the checkout tick time, not the mint time');
});
