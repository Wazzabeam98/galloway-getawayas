import { chromium } from '@playwright/test';
import { loadEnv } from './seed-lib.mjs';
import { LOCAL_URL } from './target.cjs';

const env = loadEnv();
const EMAIL = process.env.EMAIL || 'morag@gallowaymarket.test';
const SITE = process.env.SITE || LOCAL_URL;
const OUT = process.env.OUT || '.';
const BK = process.env.BK;
const SAUNA = process.env.SAUNA;
const CHEF = process.env.CHEF;

const admin = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/admin/generate_link', { method: 'POST', headers: admin, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) });
const link = await r.json();
if (!link.hashed_token) { console.error('no token', JSON.stringify(link).slice(0, 200)); process.exit(1); }
const cb = SITE + '/auth/callback?type=magiclink&next=%2Ftrips&token_hash=' + encodeURIComponent(link.hashed_token);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const unstick = () => page.evaluate(() => {
    document.querySelectorAll('body *').forEach((el) => {
        const p = getComputedStyle(el).position;
        if (p === 'fixed' || p === 'sticky') el.style.position = 'static';
    });
});
await page.goto(cb, { waitUntil: 'load' });

// 1 — the finished trip card (element crop)
await page.goto(SITE + '/trips', { waitUntil: 'load' });
await page.locator('[id^="trip-"]').first().scrollIntoViewIfNeeded();
await page.waitForTimeout(2500);
await unstick();
await page.waitForTimeout(300);
await page.locator('[id^="trip-"]').first().screenshot({ path: OUT + '/exp-1-card.png' });
console.log('wrote exp-1-card.png');

// 2 — browse grid (full page)
await page.goto(SITE + '/experiences/' + BK, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + '/exp-2-grid.png', fullPage: true });
console.log('wrote exp-2-grid.png');

// 3 — slot provider (instant book) — viewport shows the time grid + book
await page.goto(SITE + '/experiences/' + BK + '/' + SAUNA, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await unstick();
await page.screenshot({ path: OUT + '/exp-3-slot.png' });
console.log('wrote exp-3-slot.png');

// 4 — request provider (48h hold) — full page shows menu + panel
await page.goto(SITE + '/experiences/' + BK + '/' + CHEF, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT + '/exp-4-request.png', fullPage: true });
console.log('wrote exp-4-request.png');

await browser.close();
