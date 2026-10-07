// Check-in messages are stored with placeholders for the door code and wifi
// password, and filled in only for someone who may see them, at the moment
// the message is shown. A message a person typed is never touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOOR_TOKEN, WIFI_TOKEN, tokeniseSecrets, renderSecretTokens, hasSecretTokens } from '../lib/messageSecrets';

test('a stored check-in message holds placeholders, not the code or the password', () => {
    const body = tokeniseSecrets('Lockbox code 4821. Wifi: HarbourGuest / sea-breeze-77.', { codes: ['4821'], wifi: 'sea-breeze-77' });
    assert.equal(body, `Lockbox code ${DOOR_TOKEN}. Wifi: HarbourGuest / ${WIFI_TOKEN}.`);
    assert.ok(!body.includes('4821') && !body.includes('sea-breeze-77'));
});

test('only whole values: a code is never cut out of a longer number, a date or a time', () => {
    assert.equal(tokeniseSecrets('Arrive 14/10/2026 after 1500; code 1500.', { codes: ['1500'] }), `Arrive 14/10/2026 after ${DOOR_TOKEN}; code ${DOOR_TOKEN}.`);
    assert.equal(tokeniseSecrets('Booking 482199, code 4821.', { codes: ['4821'] }), `Booking 482199, code ${DOOR_TOKEN}.`);
    assert.equal(tokeniseSecrets('Room 12, code 12.', { codes: ['12'] }), 'Room 12, code 12.', 'too short to place safely — left alone');
});

test('the host and a guest inside the window see the real values, current at the time they look', () => {
    const stored = `Code ${DOOR_TOKEN}, wifi ${WIFI_TOKEN}.`;
    assert.equal(renderSecretTokens(stored, true, { doorCode: '9073', wifiPassword: 'pw-123' }), 'Code 9073, wifi pw-123.');
    assert.equal(renderSecretTokens(stored, true, { doorCode: null, wifiPassword: null }), 'Code [no door code set], wifi [no wifi password set].');
});

test('outside the window a guest sees neither, and the inbox preview never shows them', () => {
    const stored = `Code ${DOOR_TOKEN}.`;
    assert.equal(renderSecretTokens(stored, true, 'before'), 'Code [shown here 3 days before you arrive].');
    assert.equal(renderSecretTokens(stored, true, 'after'), 'Code [no longer shown].');
    assert.equal(renderSecretTokens(stored, true, 'preview'), 'Code [door code].');
});

test('a message a person typed is shown exactly as typed, placeholders and all', () => {
    const typed = `the code is 4821, and here is ${DOOR_TOKEN}`;
    assert.equal(renderSecretTokens(typed, false, { doorCode: '9999', wifiPassword: null }), typed);
    assert.ok(hasSecretTokens(typed));
});
