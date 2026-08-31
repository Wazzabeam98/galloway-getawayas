// What the site actually renders for somebody who is signed in.
//
//   npm run dev                        # in another terminal
//   node scripts/signed-in-crawl.mjs
//
// WHY THIS EXISTS, AND WHY THE FIRST TWO ATTEMPTS WERE WORTHLESS.
//
// The signed-out site has been crawled several times. The signed-in half — the
// dashboard, the calendar, earnings, trips, messages, the passport — had never
// really been looked at, because every attempt measured the wrong thing:
//
//   1. The session was assembled by hand and fetched with curl. That part was
//      actually fine, and I wrongly reported it as broken.
//   2. "Signed in?" was decided by looking for "Become a host" — which also
//      shows for a signed-in guest who has no listings. Ambiguous.
//   3. "Did the page render?" was decided by grepping the raw HTML for the
//      not-found wording. Next ships the not-found component inside the RSC
//      flight payload in <script> tags on EVERY page, so that string is
//      present whether the page rendered or not. Every admin page was reported
//      as a 404 while rendering perfectly.
//
// So the rules here are: strip <script> before reading anything, decide
// signed-in on a string that only appears when signed in, and quote what the
// page actually says rather than testing for the absence of something.

import {
    loadEnv, assertTestEnvironment, sessionCookieViaApp,
} from './seed-lib.mjs';
import { resolveTarget, LOCAL_URL } from './target.cjs';

const env = loadEnv();
assertTestEnvironment(env);

const SITE = await resolveTarget({
    runner: 'scripts/signed-in-crawl.mjs',
    envNames: ['SIGNED_IN_CRAWL_SITE'],
    fallback: LOCAL_URL,
});

// Accounts chosen for what they HAVE, not for what they are called. A crawl
// against an account with no bookings and no listings shows empty states and
// proves nothing about the pages that matter.
const WHO = {
    guest: 'demo-guest@gg-preview.test',       // one booking, no listings
    host: 'host-ready@gallowayseed.test',      // seven listings
};

const ROUTES = [
    ['/', 'home'],
    ['/trips', 'guest'],
    ['/passport', 'guest'],
    ['/messages', 'both'],
    ['/account', 'both'],
    ['/dashboard', 'host'],
    ['/dashboard/bookings', 'host'],
    ['/dashboard/calendar', 'host'],
    ['/dashboard/earnings', 'host'],
    ['/dashboard/enquiries', 'host'],
    ['/dashboard/people', 'host'],
    ['/dashboard/reviews', 'host'],
    ['/addhome', 'host'],
    ['/services', 'both'],
    ['/services/join', 'both'],
];

/** Visible text. Scripts first — that is where the false readings came from. */
function visible(html) {
    let s = html;
    for (const tag of ['script', 'style', 'noscript', 'svg']) {
        s = s.replace(new RegExp('<' + tag + '[^>]*>[\\s\\S]*?</' + tag + '>', 'gi'), ' ');
    }
    s = s.replace(/<[^>]+>/g, ' ');
    s = s.replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return s.split(/\s+/).filter(Boolean).join(' ');
}

/** The chrome every page has, so what is left is the page itself. */
function withoutChrome(text) {
    const cuts = [
        'Self Catering Holiday Cottages in Dumfries & Galloway | Galloway Getaways',
        'Galloway GETAWAYS', 'Galloway Getaways',
    ];
    let out = text;
    for (const c of cuts) out = out.split(c).join(' ');
    const footer = out.indexOf('Self catering holiday cottages and apartments across');
    if (footer > 0) out = out.slice(0, footer);
    return out.split(/\s+/).filter(Boolean).join(' ');
}

async function fetchAs(path, cookie) {
    const res = await fetch(SITE + path, {
        headers: cookie ? { Cookie: cookie } : {},
        redirect: 'manual',
    });
    const html = res.status >= 300 && res.status < 400 ? '' : await res.text();
    const text = visible(html);
    return {
        status: res.status,
        location: res.headers.get('location'),
        // Only appears when a server component resolved a session.
        signedIn: html.includes('Welcome,'),
        body: withoutChrome(text),
    };
}

function verdict(r) {
    if (r.status >= 300 && r.status < 400) return 'redirect -> ' + (r.location || '?');
    if (r.status >= 400) return 'HTTP ' + r.status;
    if (!r.body) return 'BLANK — nothing rendered';
    if (/^Loading|^Finding your perfect getaway/i.test(r.body)) return 'STUCK ON A LOADING STATE';
    if (/Sign in to|Please log in|You.ll need to be signed in/i.test(r.body)) return 'ASKS THEM TO SIGN IN';
    if (/We couldn't find that page/i.test(r.body)) return 'NOT FOUND';
    if (/Something went wrong/i.test(r.body)) return 'ERROR PAGE';
    return 'ok';
}

async function main() {
    console.log('\n  SIGNED-IN CRAWL — ' + SITE + '\n');

    const cookies = {};
    for (const [role, email] of Object.entries(WHO)) {
        cookies[role] = await sessionCookieViaApp(env, email, SITE);
        console.log('  ' + role.padEnd(6) + ' ' + email);
    }

    const problems = [];

    for (const role of ['guest', 'host']) {
        console.log('\n  ' + '='.repeat(72));
        console.log('  AS THE ' + role.toUpperCase() + ' — ' + WHO[role]);
        console.log('  ' + '='.repeat(72));

        for (const [path, forWhom] of ROUTES) {
            if (forWhom !== 'both' && forWhom !== 'home' && forWhom !== role) continue;

            const r = await fetchAs(path, cookies[role]);
            const v = verdict(r);
            const flag = v === 'ok' ? '   ' : ' ! ';
            const seen = r.signedIn ? '' : '  [SERVER SEES NO SESSION]';

            console.log(flag + path.padEnd(24) + String(r.status).padEnd(4) + v + seen);
            if (r.body) console.log('      ' + r.body.slice(0, 150));

            if (v !== 'ok' || !r.signedIn) problems.push({ role, path, verdict: v, signedIn: r.signedIn });
        }
    }

    console.log('\n  ' + '='.repeat(72));
    if (!problems.length) {
        console.log('  nothing to report — every page rendered for a signed-in caller\n');
        return 0;
    }
    console.log('  ' + problems.length + ' page(s) worth looking at:');
    for (const p of problems) {
        console.log('    ' + p.role.padEnd(6) + p.path.padEnd(24)
            + p.verdict + (p.signedIn ? '' : ' (no session seen)'));
    }
    console.log('');
    return 0;
}

main().catch((err) => {
    console.error('\n  FAILED: ' + (err && err.message) + '\n');
    process.exit(1);
});
