import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isAdminOutcome, outcomeLabel, isOpenEscalation, validateAdminResolve, ADMIN_OUTCOMES,
} from '../lib/adminResolutions';

test('isAdminOutcome accepts only the four outcomes', () => {
    assert.equal(isAdminOutcome('for_host'), true);
    assert.equal(isAdminOutcome('for_guest'), true);
    assert.equal(isAdminOutcome('split'), true);
    assert.equal(isAdminOutcome('dismissed'), true);
    assert.equal(isAdminOutcome('paid'), false);
    assert.equal(isAdminOutcome(''), false);
    assert.equal(isAdminOutcome(undefined), false);
});

test('outcomeLabel maps values and falls back for unknowns', () => {
    assert.equal(outcomeLabel('for_host'), 'For the host');
    assert.equal(outcomeLabel('dismissed'), 'Dismissed');
    assert.equal(outcomeLabel(null), 'Closed');
    assert.equal(outcomeLabel('nonsense'), 'Closed');
});

test('isOpenEscalation is true only for escalated + unresolved', () => {
    assert.equal(isOpenEscalation({ status: 'escalated', resolved_at: null }), true);
    assert.equal(isOpenEscalation({ status: 'escalated', resolved_at: '2026-09-24T00:00:00Z' }), false);
    assert.equal(isOpenEscalation({ status: 'pending', resolved_at: null }), false);
    assert.equal(isOpenEscalation({ status: 'paid', resolved_at: null }), false);
});

test('validateAdminResolve refuses a missing row', () => {
    assert.equal(validateAdminResolve(null, 'for_host', 'ok').ok, false);
});

test('validateAdminResolve refuses an already-closed or non-escalated row', () => {
    assert.equal(validateAdminResolve({ status: 'escalated', resolved_at: '2026-09-24T00:00:00Z' }, 'for_host', 'note').ok, false);
    assert.equal(validateAdminResolve({ status: 'pending', resolved_at: null }, 'for_host', 'note').ok, false);
});

test('validateAdminResolve requires a real outcome and a non-empty note', () => {
    const open = { status: 'escalated', resolved_at: null };
    assert.equal(validateAdminResolve(open, 'bogus', 'note').ok, false);
    assert.equal(validateAdminResolve(open, 'for_host', '   ').ok, false);
    assert.equal(validateAdminResolve(open, 'for_host', '').ok, false);
    const good = validateAdminResolve(open, 'for_guest', 'Guest showed the item was already broken.');
    assert.equal(good.ok, true);
    assert.equal(good.error, undefined);
});

test('every outcome in the form list validates', () => {
    const open = { status: 'escalated', resolved_at: null };
    for (const o of ADMIN_OUTCOMES) {
        assert.equal(validateAdminResolve(open, o.value, 'reason').ok, true, o.value);
    }
});
