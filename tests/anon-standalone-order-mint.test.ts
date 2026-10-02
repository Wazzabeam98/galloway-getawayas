// A signed-OUT guest placing a STANDALONE experience order must still produce an
// order row. The overnight audit (2026-09-24) proved the old path captured/held
// the money but wrote nothing: createRequestOrderFromSession inserted
// guest_id null, and service_orders' guest-present CHECK rejects a paid row with
// no guest — so the money moved and there was no record, no receipt, no provider
// notice. The slot path already minted a guest from the payer email; this locks
// in the same behaviour for the request/standalone path.
//
// The fix mints the guest BEFORE the insert, so the row carries a real guest_id.
// This test drives an anonymous instant all-standard cart through the one writer
// and asserts: a guest account is minted, the insert carries a non-null guest_id
// and status 'confirmed', and both the guest and the provider are emailed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases, stubModule, fakeSupabase } from './helpers/stub';

installAliases();

const emails: { to: string; subject: string }[] = [];
stubModule('@/lib/email', {
    sendEmail: async (to: string, subject: string) => { emails.push({ to, subject }); },
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

const { createRequestOrderFromSession } = require('@/lib/requestOrder');

function buildAdmin() {
    const captured: any = { insert: null, createUser: 0, upserts: [] };
    const fake = fakeSupabase({
        service_orders: (state: any) => {
            const ins = state.ops.find((o: any) => o.op === 'insert');
            if (ins) {
                captured.insert = ins.args[0];
                const p = ins.args[0];
                // Mirror the real CHECK: a paid row must have a guest_id.
                const ok = p.guest_id != null || ['holding', 'expired'].includes(p.status);
                return ok
                    ? { data: { id: 'order-1' }, error: null }
                    : { data: null, error: { code: '23514', message: 'service_orders_guest_present_once_paid' } };
            }
            return { data: null, error: null }; // idempotency: no existing row
        },
        service_providers: {
            data: { id: 'prov-1', business_name: 'Galloway Bakehouse', trade: 'baker', shape: 'made_to_order', contact_email: 'prov@example.com', exclusive_per_date: false },
            error: null,
        },
        service_provider_items: { data: [{ id: 'it-1', name: 'Sourdough', unit: 'each', price: 5, is_custom: false }], error: null },
        profiles: (state: any) => {
            const up = state.ops.find((o: any) => o.op === 'upsert');
            if (up) { captured.upserts.push(up.args[0]); return { data: null, error: null }; }
            const lim = state.ops.find((o: any) => o.op === 'limit');
            if (lim) return { data: [], error: null }; // findIdByEmail: none exist yet → mint
            return { data: null, error: null }; // guest read by id
        },
    });
    const admin: any = fake.client;
    admin.auth = { admin: { createUser: async () => { captured.createUser++; return { data: { user: { id: 'minted-guest-id' } }, error: null }; } } };
    return { admin, captured };
}

test('a signed-out standalone instant cart mints a guest and records a confirmed order', async () => {
    const { admin, captured } = buildAdmin();

    const session = {
        metadata: {
            kind: 'service_order', provider_id: 'prov-1', booking_id: '', guest_id: '',
            listing_id: '', service_date: '2099-06-01', service_time: '', fulfilment: 'collection',
            standalone: '1', contact_name: 'A Guest', contact_email: 'guest@example.com', contact_phone: '',
            instant: '1', cart: 'it-1:2', commission_rate: '0.10', item_unit: 'order', item_name: 'Order',
        },
        payment_intent: 'pi_test_1',
        amount_total: 1000,
        customer_details: { email: 'guest@example.com' },
    };

    const res = await createRequestOrderFromSession(admin, session);

    assert.equal(res.created, true, 'the order was recorded');
    assert.equal(captured.createUser, 1, 'a guest account was minted from the payer email');
    assert.ok(captured.insert, 'a service_orders row was inserted');
    assert.notEqual(captured.insert.guest_id, null, 'the inserted row carries a guest_id (satisfies the CHECK)');
    assert.equal(captured.insert.guest_id, 'minted-guest-id', 'the row is tied to the minted guest');
    assert.equal(captured.insert.status, 'confirmed', 'an all-standard cart is confirmed at once');
    assert.ok(emails.some((e) => e.to === 'guest@example.com'), 'the guest is emailed a receipt');
    assert.ok(emails.some((e) => e.to === 'prov@example.com'), 'the provider is told about the order');
});
