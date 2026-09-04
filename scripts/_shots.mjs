import { chromium } from '@playwright/test';
import { loadEnv } from './seed-lib.mjs';
import { LOCAL_URL } from './target.cjs';

const env = loadEnv();
const ME = 'liamworrall18@hotmail.com';
const SITE = process.env.SITE || LOCAL_URL;
const OUT = process.env.OUT || '.';

const admin = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/admin/generate_link', { method: 'POST', headers: admin, body: JSON.stringify({ type: 'magiclink', email: ME }) });
const link = await r.json();
if (!link.hashed_token) { console.error('no token', JSON.stringify(link).slice(0, 200)); process.exit(1); }
const cb = SITE + '/auth/callback?type=magiclink&next=%2Ftrips&token_hash=' + encodeURIComponent(link.hashed_token);

// The top nav is fixed/sticky and overlaps the card top in an element
// screenshot. Drop any fixed/sticky element to static so nothing overlays the
// card. (Leaflet uses absolute/relative panes, so the map is untouched.)
const unstick = () => page.evaluate(() => {
    document.querySelectorAll('body *').forEach((el) => {
        const p = getComputedStyle(el).position;
        if (p === 'fixed' || p === 'sticky') (el).style.position = 'static';
    });
});

const shoot = async (path) => {
    await page.goto(SITE + '/trips', { waitUntil: 'load' });
    await page.locator('[id^="trip-"]').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(3000); // let OSM tiles settle
    await unstick();
    // Open the payment breakdown so the figures show in the shot.
    await page.getByRole('button', { name: 'Show breakdown' }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    await page.locator('[id^="trip-"]').first().screenshot({ path });
    console.log('wrote', path);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(cb, { waitUntil: 'load' });
await shoot(OUT + '/trips-1440.png');

await page.setViewportSize({ width: 375, height: 1000 });
await shoot(OUT + '/trips-375.png');

await browser.close();
