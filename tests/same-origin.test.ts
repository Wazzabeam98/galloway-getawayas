// fromOwnSite decides whether a request came from one of our own pages. It is
// the lock on the two paid /api/address routes: a cross-site page or a bare
// script must not be able to spend Ideal Postcodes credits, while a signed-out
// guest on our own sign-up or checkout page must still get through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromOwnSite } from '../lib/sameOrigin';

const h = (obj: Record<string, string>) => new Headers(obj);

test('a browser fetch from our own page is allowed (Sec-Fetch-Site)', () => {
    // This is what our pages send: a relative fetch('/api/address/...').
    assert.equal(fromOwnSite(h({ 'sec-fetch-site': 'same-origin', host: 'gallowaygetaways.co.uk' })), true);
    assert.equal(fromOwnSite(h({ 'sec-fetch-site': 'same-site', host: 'gallowaygetaways.co.uk' })), true);
    // Case/space from different engines must not matter.
    assert.equal(fromOwnSite(h({ 'sec-fetch-site': ' Same-Origin ' })), true);
});

test('works in every environment without naming a domain', () => {
    // A preview URL and localhost send same-origin just the same.
    assert.equal(fromOwnSite(h({ 'sec-fetch-site': 'same-origin', host: 'galloway-git-x.vercel.app' })), true);
    assert.equal(fromOwnSite(h({ 'sec-fetch-site': 'same-origin', host: 'localhost:3000' })), true);
});

test('a cross-site page or a direct paste is refused', () => {
    assert.equal(fromOwnSite(h({ 'sec-fetch-site': 'cross-site', host: 'gallowaygetaways.co.uk' })), false);
    assert.equal(fromOwnSite(h({ 'sec-fetch-site': 'none', host: 'gallowaygetaways.co.uk' })), false);
});

test('a bare script (no browser headers at all) is refused', () => {
    assert.equal(fromOwnSite(h({ host: 'gallowaygetaways.co.uk' })), false);
    assert.equal(fromOwnSite(h({})), false);
});

test('without Sec-Fetch-Site, Origin/Referer host must match the host reached', () => {
    // Older browser, same-origin GET that omitted Origin: fall back to Referer.
    assert.equal(
        fromOwnSite(h({ host: 'gallowaygetaways.co.uk', referer: 'https://gallowaygetaways.co.uk/sign-up' })),
        true,
    );
    assert.equal(
        fromOwnSite(h({ host: 'gallowaygetaways.co.uk', origin: 'https://gallowaygetaways.co.uk' })),
        true,
    );
    // Origin from somewhere else is refused even on an old client.
    assert.equal(
        fromOwnSite(h({ host: 'gallowaygetaways.co.uk', origin: 'https://evil.example.com' })),
        false,
    );
});
