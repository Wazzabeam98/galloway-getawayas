// The installed app's prompts: the notifications card on first open (or right
// after signing in), "Not now" holding for a week, and the Add to Home Screen
// hint shown once per device, in Safari only, never in the installed app.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

const store: Record<string, string> = {};
(global as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
};
(global as any).window = global;
const ua = (s: string) => Object.defineProperty(global, 'navigator', { value: { userAgent: s }, configurable: true, writable: true });
ua('');

const pc = require('../lib/pushClient');

const base = { standalone: true, supported: true, permission: 'default', signedIn: true, firstRunDone: false, snoozed: false, path: '/' };

test('first open of the installed app, signed in: ask straight away', () => {
    assert.equal(pc.shouldAskOnFirstRun(base), true);
});

test('not signed in yet: wait — and ask the moment they are', () => {
    assert.equal(pc.shouldAskOnFirstRun({ ...base, signedIn: false }), false);
    assert.equal(pc.shouldAskOnFirstRun({ ...base, signedIn: true }), true);
    assert.equal(pc.shouldAskOnFirstRun({ ...base, path: '/auth/callback' }), false, 'not mid sign-in');
});

test('never in a browser tab, never once answered, never once the iPhone has decided', () => {
    assert.equal(pc.shouldAskOnFirstRun({ ...base, standalone: false }), false);
    assert.equal(pc.shouldAskOnFirstRun({ ...base, firstRunDone: true }), false);
    assert.equal(pc.shouldAskOnFirstRun({ ...base, permission: 'granted' }), false);
    assert.equal(pc.shouldAskOnFirstRun({ ...base, permission: 'denied' }), false);
    assert.equal(pc.shouldAskOnFirstRun({ ...base, supported: false }), false);
    assert.equal(pc.shouldAskOnFirstRun({ ...base, snoozed: true }), false);
});

test('"Not now" holds for a week, then a booking or message may ask again', () => {
    const t0 = Date.UTC(2026, 9, 19, 20, 0);
    assert.equal(pc.askDismissed(t0), false);
    pc.dismissAsk(t0);
    assert.equal(pc.askDismissed(t0 + 60 * 1000), true);
    assert.equal(pc.askDismissed(t0 + 6 * 86400000), true, 'six days: still held');
    assert.equal(pc.askDismissed(t0 + 7 * 86400000 + 1), false, 'a week on: may ask again');
    assert.equal(pc.ASK_AGAIN_AFTER_MS, 7 * 86400000);
});

test('the first-open card is once per device', () => {
    assert.equal(pc.firstRunDone(), false);
    pc.markFirstRunDone();
    assert.equal(pc.firstRunDone(), true);
});

test('the Home Screen hint is for Safari on an iPhone, not other browsers or apps’ built-in ones', () => {
    const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';
    ua(safari); assert.equal(pc.isIOSSafari(), true);
    ua(safari.replace('Version/18.7', 'CriOS/130.0')); assert.equal(pc.isIOSSafari(), false, 'Chrome on iPhone');
    ua('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0'); assert.equal(pc.isIOSSafari(), false, 'Instagram');
    ua(safari + ' [FBAN/FBIOS;FBAV/480.0]'); assert.equal(pc.isIOSSafari(), false, 'Facebook');
    ua('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'); assert.equal(pc.isIOSSafari(), false);
    ua('');
});

test('the hint: once per device (server cookie for a year + local note), never in the installed app, Safari’s icons drawn in, a button to close it', () => {
    const setup = fs.readFileSync(path.join(ROOT, 'components/pwa/PwaSetup.tsx'), 'utf8');
    assert.match(setup, /isStandalone\(\)\) return;/, 'never inside the installed app');
    assert.match(setup, /if \(hintSeen\(\)\) return;/);
    assert.ok(setup.indexOf('rememberHint();') < setup.indexOf('setHint(true);'), 'remembered the moment it appears');
    assert.match(setup, /<AddToHomeScreenSteps \/>/);
    assert.match(setup, /Got it/);
    const route = fs.readFileSync(path.join(ROOT, 'app/api/pwa/seen/route.ts'), 'utf8');
    assert.match(route, /Max-Age=31536000/);
    const steps = fs.readFileSync(path.join(ROOT, 'components/pwa/AddToHomeScreenSteps.tsx'), 'utf8');
    assert.match(steps, /function ShareIcon/);
    assert.match(steps, /Add to Home Screen/);
});

test('outside Account settings, iPhone Safari gets no second "add to Home Screen" box', () => {
    const src = fs.readFileSync(path.join(ROOT, 'components/pwa/PushPrompt.tsx'), 'utf8');
    assert.match(src, /if \(needsHomeScreenFirst\(\)\) \{\s*if \(always && /);
    const settings = fs.readFileSync(path.join(ROOT, 'components/account/PushSettings.tsx'), 'utf8');
    assert.match(settings, /<PushPrompt context="settings"[^>]*always/, 'still in Account settings');
});
