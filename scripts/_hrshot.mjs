import { chromium } from '@playwright/test';
import { loadEnv } from './seed-lib.mjs';
import { LOCAL_URL } from './target.cjs';

const env = loadEnv();
const ME = process.env.EMAIL || 'liamworrall18@hotmail.com';
const SITE = process.env.SITE || LOCAL_URL;
const OUT = process.env.OUT || '.';
const LABEL = process.env.LABEL || 'all';
const LISTING = process.env.LISTING;
const EXPAND = process.env.EXPAND === '1';

const admin = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/admin/generate_link', { method: 'POST', headers: admin, body: JSON.stringify({ type: 'magiclink', email: ME }) });
const link = await r.json();
const cb = SITE + '/auth/callback?type=magiclink&next=%2Ftrips&token_hash=' + encodeURIComponent(link.hashed_token);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const unstick = () => page.evaluate(() => {
    document.querySelectorAll('body *').forEach((el) => { const p = getComputedStyle(el).position; if (p === 'fixed' || p === 'sticky') el.style.position = 'static'; });
});
await page.goto(cb, { waitUntil: 'load' });

const shotCard = async (w) => {
    await page.setViewportSize({ width: w, height: 1000 });
    await page.goto(SITE + '/trips', { waitUntil: 'load' });
    await page.locator('[id^="trip-"]').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    if (EXPAND) { await page.getByRole('button', { name: 'Show more' }).first().click().catch(() => {}); await page.waitForTimeout(400); }
    await unstick();
    await page.waitForTimeout(300);
    await page.locator('[id^="trip-"]').first().screenshot({ path: OUT + '/hr-' + LABEL + '-card-' + w + '.png' });
    console.log('wrote hr-' + LABEL + '-card-' + w + '.png');
};
await shotCard(1440);
if (process.env.MOBILE === '1') await shotCard(375);

if (LISTING) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(SITE + '/homes/' + LISTING, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    if (EXPAND) { await page.getByRole('button', { name: 'Show more' }).first().click().catch(() => {}); await page.waitForTimeout(400); }
    await unstick();
    await page.screenshot({ path: OUT + '/hr-' + LABEL + '-listing.png', fullPage: true });
    console.log('wrote hr-' + LABEL + '-listing.png');
}
await browser.close();
