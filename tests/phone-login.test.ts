// The phone sign-in pre-check decision, and that the normaliser the check and
// the account-link both rely on reduces every UK-typed form to one value.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { phoneLoginDecision, PHONE_UNCONFIRMED_MESSAGE } from '../lib/phoneLogin';
import { ukMobileToE164 } from '../lib/signInIdentifier';

test('only an unconfirmed number blocks sign-in; login and new proceed', () => {
    assert.deepEqual(phoneLoginDecision('login'), { blocked: false });
    assert.deepEqual(phoneLoginDecision('new'), { blocked: false });
    const b = phoneLoginDecision('unconfirmed');
    assert.equal(b.blocked, true);
    assert.equal(b.message, PHONE_UNCONFIRMED_MESSAGE);
    // An unexpected / missing state must fail OPEN (never lock sign-in).
    assert.deepEqual(phoneLoginDecision(null), { blocked: false });
    assert.deepEqual(phoneLoginDecision(undefined), { blocked: false });
    assert.deepEqual(phoneLoginDecision('something-else'), { blocked: false });
});

test('the block message points at the fix (email + confirm in settings)', () => {
    assert.match(PHONE_UNCONFIRMED_MESSAGE, /email/i);
    assert.match(PHONE_UNCONFIRMED_MESSAGE, /settings/i);
});

test('UK mobile forms all normalise to the same E.164, matching the DB phone_norm', () => {
    // The SQL phone_norm stores digits ("447700900123"); ukMobileToE164 keeps the
    // leading "+". Both the route input and the account-link go through this, and
    // the function strips the "+" server-side, so the two always meet.
    for (const raw of ['07700 900123', '+44 7700 900123', '447700900123', '+447700900123', '(0)7700900123']) {
        assert.equal(ukMobileToE164(raw), '+447700900123', `failed for ${raw}`);
    }
    // Not a UK mobile → null (the field refuses it; the route then proceeds).
    assert.equal(ukMobileToE164('12345'), null);
    assert.equal(ukMobileToE164('+15551234567'), null);
    assert.equal(ukMobileToE164('0200 000 0000'), null); // London landline, not 07
});
