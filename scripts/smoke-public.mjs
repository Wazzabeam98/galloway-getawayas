// The post-deploy smoke check: is the live site actually usable by a stranger?
//
//   node scripts/smoke-public.mjs            # checks production
//   SMOKE_URL=https://preview… node scripts/smoke-public.mjs
//
// WHY THIS EXISTS
//
// On 19 October 2026 a migration granted a new listings column to signed-in
// users only. The public listing page reads that column as the logged-out
// `anon` role, so PostgREST refused the whole read and EVERY listing page 404'd
// for anyone not signed in. The build was green, the tests were green, the
// deploy succeeded — and the site was broken for logged-out visitors for about
// two hours before a person happened to look.
//
// Nothing a signed-in developer does reproduces it: you have to be a stranger.
// So this loads, as a stranger with no cookies, the handful of pages a stranger
// actually lands on — the homepage, the cottage browse, one real live listing,
// the experiences marketplace and one real live experience — and shouts if any
// of them errors, 404s or comes back empty. Run after every production deploy
// (.github/workflows/post-deploy-smoke.yml); it emails the owner on any failure.
//
// It talks ONLY over HTTP, exactly as a browser would, and reads nothing from
// the database — the live listing and experience it opens are discovered from
// the links the homepage and marketplace actually render, so a stranger's real
// path is what gets tested, and a single unpublished listing can never make it
// cry wolf.

const BASE = (process.env.SMOKE_URL || 'https://gallowaygetaways.co.uk').replace(/\/+$/, '');

// A full HTML page even when it is the 404 page (header + footer), so size alone
// proves nothing — the HTTP STATUS is the signal. notFound() returns 404; a
// rendered page returns 200. This floor only catches a truly blank response.
const MIN_BYTES = 500;
const TIMEOUT_MS = 20000;

// A browser-shaped request with NO cookies — this is the whole point, the
// logged-out visitor the developer never is.
async function get(pathOrUrl) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : BASE + pathOrUrl;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            redirect: 'follow',
            headers: {
                'user-agent': 'GallowayGetaways-SmokeCheck/1.0 (+post-deploy health check)',
                accept: 'text/html',
            },
            signal: controller.signal,
        });
        const body = await res.text();
        return { url, status: res.status, body };
    } catch (err) {
        return { url, status: 0, body: '', error: (err && err.message) || String(err) };
    } finally {
        clearTimeout(timer);
    }
}

function titleOf(html) {
    const m = html.match(/<title>([^<]*)<\/title>/i);
    return m ? m[1].trim() : '';
}

// Links the page actually rendered, deduped. UUIDs only, so a stray relative
// path can't be mistaken for a listing.
function links(html, re) {
    return [...new Set([...html.matchAll(re)].map((m) => m[0]))];
}
const LISTING_LINK = /\/homes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const EXPERIENCE_LINK = /\/experiences\/browse\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

const failures = [];
function fail(what, detail) {
    failures.push({ what, detail });
    console.log('  ✗ ' + what + ' — ' + detail);
}
function ok(what) {
    console.log('  ✓ ' + what);
}

// A page "rendered" if it answered 200 with real content and is not the
// not-found page. Anything else — a 404, a 500, a redirect that landed on the
// error page, a timeout, a blank body — is a failure.
function renders(res, label) {
    if (res.status === 0) { fail(label, 'request failed: ' + res.error); return false; }
    if (res.status === 404) { fail(label, 'returned 404 Not Found (' + res.url + ')'); return false; }
    if (res.status !== 200) { fail(label, 'returned HTTP ' + res.status + ' (' + res.url + ')'); return false; }
    if (res.body.length < MIN_BYTES) { fail(label, 'came back empty — only ' + res.body.length + ' bytes (' + res.url + ')'); return false; }
    if (/^Page not found/i.test(titleOf(res.body))) { fail(label, 'rendered the “Page not found” page (' + res.url + ')'); return false; }
    return true;
}

async function main() {
    console.log('smoke: ' + BASE + '\n');

    // 1) The homepage — always populated, and the source of a real live listing
    //    and experience link to follow.
    const home = await get('/');
    let listingPath = null;
    let experiencePath = null;
    if (renders(home, 'homepage (/)')) {
        const homeListings = links(home.body, LISTING_LINK);
        const homeExperiences = links(home.body, EXPERIENCE_LINK);
        if (homeListings.length === 0) fail('homepage listings', 'the homepage rendered but shows no live cottages');
        else { ok('homepage shows ' + homeListings.length + ' cottage(s)'); listingPath = homeListings[0]; }
        if (homeExperiences.length > 0) experiencePath = homeExperiences[0];
    }

    // 2) The cottage browse — a fixed, always-present area landing page.
    const browse = await get('/holiday-cottages/kirkcudbright');
    if (renders(browse, 'cottage browse (/holiday-cottages/kirkcudbright)')) {
        if (links(browse.body, LISTING_LINK).length === 0) fail('cottage browse', 'the browse page rendered but lists no cottages');
        else ok('cottage browse lists cottages');
    }

    // 3) One real, live listing — the exact page that 404'd in the incident.
    if (listingPath) {
        const listing = await get(listingPath);
        if (renders(listing, 'live listing (' + listingPath + ')')) ok('a live listing opens for a logged-out visitor');
    } else {
        fail('live listing', 'no live listing link was found to open — see the homepage failure above');
    }

    // 4) The experiences marketplace — and a live experience link if the
    //    homepage did not already give us one.
    const market = await get('/experiences/browse');
    if (renders(market, 'experiences marketplace (/experiences/browse)')) {
        const marketExperiences = links(market.body, EXPERIENCE_LINK);
        if (marketExperiences.length === 0 && !experiencePath) {
            fail('experiences marketplace', 'the marketplace rendered but shows no live experiences');
        } else {
            ok('experiences marketplace shows experiences');
            if (!experiencePath && marketExperiences.length > 0) experiencePath = marketExperiences[0];
        }
    }

    // 5) One real, live experience.
    if (experiencePath) {
        const experience = await get(experiencePath);
        if (renders(experience, 'live experience (' + experiencePath + ')')) ok('a live experience opens for a logged-out visitor');
    } else {
        fail('live experience', 'no live experience link was found to open');
    }

    console.log('');
    if (failures.length === 0) {
        console.log('smoke: all public pages render for a logged-out visitor.');
        return 0;
    }

    console.error('smoke: ' + failures.length + ' failure(s):');
    failures.forEach((f) => console.error('  - ' + f.what + ': ' + f.detail));
    await emailOwner();
    return 1;
}

// Email the owner on failure, the same way the restore drill does — a direct
// Resend send, so this works from a GitHub Action runner with no app server and
// even when the deploy itself is so broken nothing on it would run. Fails open
// on the email itself (a missing key must never hide the real failure).
async function emailOwner() {
    const key = process.env.RESEND_API_KEY;
    const recipients = (process.env.SMOKE_ALERT_EMAIL || process.env.ACCOUNTS_ALERT_EMAIL || process.env.ALERT_EMAIL || '')
        .split(',').map((s) => s.trim()).filter(Boolean);

    if (!key || recipients.length === 0) {
        console.error('smoke: RESEND_API_KEY or a recipient (SMOKE_ALERT_EMAIL / ACCOUNTS_ALERT_EMAIL) is not set — no email sent');
        return;
    }

    const rows = failures.map((f) =>
        `<li style="margin-bottom:6px;"><strong>${escapeHtml(f.what)}</strong><br>` +
        `<span style="color:#b91c1c;">${escapeHtml(f.detail)}</span></li>`).join('');
    const runUrl = process.env.RUN_URL ? `<p style="font-size:13px;"><a href="${escapeHtml(process.env.RUN_URL)}">See the check run</a></p>` : '';
    const html =
        `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;">` +
        `<h2 style="color:#b91c1c;margin:0 0 8px;">The live site is failing for logged-out visitors</h2>` +
        `<p style="font-size:14px;color:#334155;">A post-deploy check of <a href="${escapeHtml(BASE)}">${escapeHtml(BASE)}</a> ` +
        `found ${failures.length} problem(s) a signed-out visitor would hit right now:</p>` +
        `<ul style="font-size:14px;color:#334155;padding-left:18px;">${rows}</ul>` +
        `<p style="font-size:14px;color:#334155;">Check the most recent production deploy — most likely a migration granted a ` +
        `new column to signed-in users only, so the public page read is refused. See scripts/smoke-public.mjs.</p>` +
        runUrl +
        `<p style="font-size:12px;color:#94a3b8;margin-top:16px;">Automated post-deploy smoke check. It loads the homepage, the cottage browse, one live listing, the experiences marketplace and one live experience as a logged-out visitor.</p>` +
        `</div>`;

    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
            body: JSON.stringify({
                from: 'Galloway Getaways <bookings@gallowaygetaways.co.uk>',
                to: recipients,
                subject: 'Live site smoke check FAILED — ' + failures.length + ' public page(s) broken',
                html,
            }),
        });
        if (!res.ok) console.error('smoke: email failed:', res.status, await res.text());
        else console.error('smoke: emailed ' + recipients.join(', '));
    } catch (err) {
        console.error('smoke: email threw (failing open):', (err && err.message) || err);
    }
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

main().then((code) => process.exit(code)).catch((err) => {
    // A bug in the check itself must be loud, not a silent green.
    console.error('smoke: the check itself errored:', (err && err.stack) || err);
    process.exit(1);
});
