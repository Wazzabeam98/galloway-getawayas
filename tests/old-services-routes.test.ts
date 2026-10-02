// The old /services pages — /services/property and one page per trade — are now
// the single list at /services, with trade as a filter. Three things have to
// agree about that, and each was wrong once:
//
//   next.config.js     answers the old URLs with a PERMANENT (308) redirect.
//                      redirect() in a page is a 307 on Next 13.5, which tells
//                      Google to keep the old address.
//   tradeListHref()    where anything inside the app sends someone back to a
//                      trade's list — one hop, never via /services/<trade>.
//   the sitemap        does not offer Google a URL that only redirects.
//
// next.config.js cannot import TypeScript, so its table is written out by hand.
// This is what stops it drifting from TRADES and from tradeListHref().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');

/* eslint-disable @typescript-eslint/no-var-requires */
const { TRADES, tradeListHref } = require('@/lib/serviceProviders');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

async function configRedirects(): Promise<Array<{ source: string; destination: string; permanent: boolean }>> {
    const config = require(path.join(ROOT, 'next.config.js'));
    return config.redirects();
}

test('every trade key has a permanent redirect to where tradeListHref says its list is', async () => {
    const redirects = await configRedirects();
    for (const t of TRADES) {
        const r = redirects.find((x) => x.source === '/services/' + t.key);
        assert.ok(r, `/services/${t.key} has no redirect in next.config.js — add it to OLD_TRADE_PAGES`);
        assert.equal(r.permanent, true, `/services/${t.key} must be a permanent (308) redirect`);
        assert.equal(r.destination, tradeListHref(t.key),
            `/services/${t.key} redirects to ${r.destination} but tradeListHref says ${tradeListHref(t.key)}`);
    }
});

test('/services/property is a permanent redirect to /services', async () => {
    const r = (await configRedirects()).find((x) => x.source === '/services/property');
    assert.ok(r);
    assert.equal(r.permanent, true);
    assert.equal(r.destination, '/services');
});

test('no redirect lands on another redirect', async () => {
    const redirects = await configRedirects();
    const sources = new Set(redirects.map((r) => r.source));
    for (const r of redirects) {
        const pathOnly = r.destination.split('?')[0];
        assert.ok(!sources.has(pathOnly), `${r.source} → ${r.destination} is two hops`);
    }
});

test('tradeListHref never points at a per-trade page', () => {
    for (const t of TRADES) {
        assert.ok(!/^\/services\/[^?]/.test(tradeListHref(t.key)), `${t.key} → ${tradeListHref(t.key)}`);
    }
    assert.equal(tradeListHref('joiner'), '/services?trade=joiner');
    assert.equal(tradeListHref('sponge'), '/services');
    assert.equal(tradeListHref('guest'), '/');
});

test('a hidden provider profile goes straight to the list, not via /services/<trade>', () => {
    const body = read('app/services/[trade]/[providerId]/page.tsx');
    assert.ok(body.includes('redirect(tradeListHref(params.trade))'),
        'the profile page no longer sends a hidden provider through tradeListHref');
    assert.ok(!/redirect\(\s*['"`]\/services\/['"`]\s*\+/.test(body),
        'the profile page redirects to /services/<trade>, which is itself a redirect');
});

test('the sitemap does not list the per-trade URLs', () => {
    const body = read('app/sitemap.xml/route.ts');
    assert.ok(!/\/services\/\$\{/.test(body), 'the sitemap builds /services/<trade> entries, which only redirect');
    assert.ok(!body.includes('SHOP_TRADES'), 'the sitemap still reads the trade list');
});

test('the trade layout no longer promises ordering by distance', () => {
    const body = read('app/services/[trade]/layout.tsx');
    assert.ok(!/how close/i.test(body.replace(/^\s*\/\/.*$/gm, '')),
        'the layout copy still says results are ordered by how close they are');
});
