import { chromium } from '@playwright/test';
import { loadEnv } from './seed-lib.mjs';
import { LOCAL_URL } from './target.cjs';

const env = loadEnv();
const SITE = process.env.SITE || LOCAL_URL;
const OUT = process.env.OUT || '.';
const BK = process.env.BK;
const SAUNA = process.env.SAUNA, WHISKY = process.env.WHISKY, CHEF = process.env.CHEF;

const admin = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };
const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/admin/generate_link', { method: 'POST', headers: admin, body: JSON.stringify({ type: 'magiclink', email: 'morag@gallowaymarket.test' }) });
const link = await r.json();
const cb = SITE + '/auth/callback?type=magiclink&next=%2Ftrips&token_hash=' + encodeURIComponent(link.hashed_token);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const unstick = () => page.evaluate(() => document.querySelectorAll('body *').forEach((el) => { const p = getComputedStyle(el).position; if (p === 'fixed' || p === 'sticky') el.style.position = 'static'; }));
await page.goto(cb, { waitUntil: 'load' });

async function card(path, name) {
    await page.goto(SITE + path, { waitUntil: 'load' });
    await page.locator('[id^="trip-"]').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    await unstick(); await page.waitForTimeout(300);
    await page.locator('[id^="trip-"]').first().screenshot({ path: OUT + '/' + name });
    console.log('wrote', name);
}
async function pageShot(path, name) {
    await page.goto(SITE + path, { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    await unstick(); await page.waitForTimeout(200);
    await page.screenshot({ path: OUT + '/' + name, fullPage: true });
    console.log('wrote', name);
}

await card('/trips', 'ov-card.png');
await card('/trips?exp=top', 'ov-exp-top.png');
await card('/trips?exp=arrival', 'ov-exp-arrival.png');
await pageShot('/experiences/' + BK, 'ov-grid.png');
await pageShot('/experiences/' + BK + '/' + SAUNA, 'ov-sauna.png');
await pageShot('/experiences/' + BK + '/' + WHISKY, 'ov-whisky.png');
await pageShot('/experiences/' + BK + '/' + CHEF, 'ov-chef.png');
await browser.close();
