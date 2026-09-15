// Make the homepage demo-ready on TEST: 8 experiences and 8 properties, every
// card with a real, topic-matched stock photo.
//
// TEST ONLY (seed-lib refuses a non-test key). Idempotent — re-running replaces
// the demo cottages and re-photographs the same experiences.
//
// Photos are Creative-Commons stock from Openverse (commercial-use, keyword-
// matched). NONE of this touches production, and no production photography is
// copied onto these fake rows — every image here is stock fetched fresh.
//
//   node scripts/demo-homepage.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, assertTestEnvironment, supabaseClient, sleep } from './seed-lib.mjs';

// Downloaded images are cached here so a re-run doesn't refetch, and so each can
// be eyeballed before upload. Delete a file to force it to be fetched again.
const CACHE = '/tmp/demo-images';
fs.mkdirSync(CACHE, { recursive: true });

const env = loadEnv('.env.local');
assertTestEnvironment(env);
const db = supabaseClient(env);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// The eight experiences to feature, and the Openverse search that matches what
// each one actually is. `pick` is which search result to take (0 = first) — bump
// it to swap a specific photo without disturbing the others.
const KEEP = [
    { id: '1d93196d-f162-43e0-9cda-0ac43dbbd01e', name: 'A Galloway table (chef)',  kw: 'restaurant food plate', pick: 0 },
    { id: '2d2f9e06-094f-4b08-ae09-756b58dbdce1', name: 'Fintry Wood-Fired Sauna',   kw: 'sauna room', pick: 0 },
    { id: '5770a45a-0f42-496d-8355-f8a59c04f27e', name: 'Galloway Whisky Tastings',  kw: 'whisky tasting glass', pick: 0 },
    { id: '0050740c-c980-4bf5-af0a-f0e9ea136e30', name: 'Harbour Yoga',              kw: 'yoga pose', pick: 2 },
    { id: '2762d0fa-d8a8-4084-980e-7e4b71be1eef', name: 'Lens & Light (photo)',      kw: 'wedding photographer', pick: 4 },
    { id: '2f524734-c4a0-413a-9584-395903755ca4', name: 'Morning paddle (kayak)',    kw: 'sea kayak',           pick: 0 },
    { id: 'a3015563-94fc-4f8d-b566-4f4416ee634b', name: 'Solway Wild Swimming',      kw: 'wild swimming',       pick: 0 },
    { id: 'e06f5872-4956-46f8-bc93-0b066349766b', name: 'The Cottage Hamper Co.',    kw: 'gift hamper', pick: 2 },
];

// The five overlapping duplicates (two more chefs, a second yoga, a second wild
// swim, a bakery) — kept in the database but made ineligible so the grid shows a
// clean, varied eight. Reversible: flip stripe_payouts_enabled back to true.
const DEACTIVATE = [
    '2a641464-81fa-4d3a-94da-71c6e976e729', // Mobile Yoga
    'dd5db320-375c-4e4d-b146-71b81c2d1808', // Rosa Muir
    '1a88560f-9e68-4766-8a66-c17a13524527', // Rosa’s Table
    '96b7ed29-66fd-49fa-b9d0-ae2101f8bd3e', // Solway Table
    '443efa88-f832-4ce3-93aa-b85988d77a8b', // Sunrise wild swim
];

// Eight believable cottages. Real Dumfries & Galloway towns, sensible prices.
const COTTAGES = [
    { slug: 'anchorage',  title: 'Anchorage Cottage',      town: 'Kirkcudbright',      street: 'Castlebank',      postcode: 'DG6 4JG', price: 145, guests: 4, kw: 'stone cottage',       pick: 0 },
    { slug: 'herons',     title: 'Heron’s Rest',           town: 'Gatehouse of Fleet', street: '3 Fleet Street',  postcode: 'DG7 2HP', price: 120, guests: 2, kw: 'english cottage', pick: 8 },
    { slug: 'harbour',    title: 'The Harbourmaster’s House', town: 'Kirkcudbright',   street: 'Harbour Square',  postcode: 'DG6 4HY', price: 185, guests: 6, kw: 'fishing harbour village', pick: 9 },
    { slug: 'deeview',    title: 'Dee View Cottage',       town: 'Castle Douglas',     street: '12 Carlingwark', postcode: 'DG7 1TJ', price: 135, guests: 4, kw: 'cottage house',       pick: 2 },
    { slug: 'bracken',    title: 'Bracken Bothy',          town: 'Newton Stewart',     street: 'Minnigaff',       postcode: 'DG8 6PL', price: 95,  guests: 2, kw: 'log cabin',           pick: 0 },
    { slug: 'shore',      title: 'Shore Cottage',          town: 'Rockcliffe',         street: 'The Merse',       postcode: 'DG5 4QG', price: 210, guests: 6, kw: 'coastal cottage',     pick: 0 },
    { slug: 'kirkbrae',   title: 'Kirkbrae Cottage',       town: 'Wigtown',            street: 'North Main St',   postcode: 'DG8 9HN', price: 110, guests: 3, kw: 'cottage exterior', pick: 0 },
    { slug: 'steading',   title: 'The Old Steading',       town: 'Dalbeattie',         street: 'Buittle',         postcode: 'DG7 1NQ', price: 165, guests: 5, kw: 'farmhouse',          pick: 0 },
];

const UA = { 'User-Agent': 'gg-demo-seed/1.0 (test data seeding)' };

// A card wants a decent-but-not-huge photo: pin a Flickr static URL to its 800px
// (_c) rendition — big enough to look sharp, comfortably under the bucket's size
// limit. Non-Flickr URLs are left as-is and guarded by the size cap below.
const MAX_BYTES = 4 * 1024 * 1024;
function sizedFlickr(url) {
    const m = url.match(/^(https:\/\/live\.staticflickr\.com\/.+?)(?:_[a-z])?(\.[a-z]+)$/i);
    return m ? m[1] + '_c' + m[2] : url;
}
async function download(url) {
    try {
        const r = await fetch(url, { redirect: 'follow', headers: UA });
        if (!r.ok) return null;
        const buf = Buffer.from(await r.arrayBuffer());
        // Too small = a broken/placeholder thumb; too big = a raw original that
        // the bucket will reject. Skip both and let the caller try the next hit.
        return buf.length > 20000 && buf.length < MAX_BYTES ? buf : null;
    } catch { return null; }
}
// Two Creative-Commons sources, so one being rate-limited or thin on a term
// doesn't stall the run: Openverse first (better photography), Wikimedia Commons
// as the fallback (generous limits, sized thumbnails).
async function fromOpenverse(query, pick) {
    const api = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license_type=commercial&size=large&page_size=12&mature=false`;
    const r = await fetch(api, { headers: UA });
    if (r.status === 429) return 'retry';
    if (!r.ok) return null;
    const results = ((await r.json()).results || []).filter((x) => x && x.url);
    for (let i = pick; i < results.length; i++) {
        const buf = (await download(sizedFlickr(results[i].url))) || (await download(results[i].url));
        if (buf) return buf;
    }
    return null;
}
async function fromCommons(query, pick) {
    const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(query + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url&iiurlwidth=1000`;
    const r = await fetch(api, { headers: UA });
    if (!r.ok) return null;
    const pages = Object.values(((await r.json()).query || {}).pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    for (let i = pick; i < pages.length; i++) {
        const u = pages[i].imageinfo && pages[i].imageinfo[0] && pages[i].imageinfo[0].thumburl;
        if (u) { const buf = await download(u); if (buf) return buf; }
    }
    return null;
}
// Commons first (fast, no tight rate limit), Openverse as a fallback. Cached to
// disk by `slug` so re-runs are instant and each image can be inspected.
async function fetchStock(slug, query, pick = 0) {
    const cached = path.join(CACHE, slug + '.jpg');
    if (fs.existsSync(cached) && fs.statSync(cached).size > 20000) return fs.readFileSync(cached);

    for (let attempt = 0; attempt < 5; attempt++) {
        try { const cm = await fromCommons(query, pick); if (cm) { fs.writeFileSync(cached, cm); return cm; } } catch { /* fall through */ }
        try { const ov = await fromOpenverse(query, pick); if (ov && ov !== 'retry') { fs.writeFileSync(cached, ov); return ov; } } catch { /* retry */ }
        await sleep(2000 + attempt * 2000);
    }
    throw new Error('could not fetch stock for "' + query + '" (' + slug + ')');
}

async function upload(key, bytes) {
    const r = await fetch(`${SB}/storage/v1/object/listings/${key}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KEY, apikey: KEY, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
        body: bytes,
    });
    if (!r.ok) throw new Error('upload ' + key + ': ' + (await r.text()).slice(0, 160));
    return key;
}

async function run() {
    console.log('— Experiences: photograph 8, deactivate 5 —');
    for (const e of KEEP) {
        const bytes = await fetchStock('exp-' + e.id, e.kw, e.pick);
        const key = await upload(`demo/exp-${e.id}.jpg`, bytes);
        // The card hero is the first active item's image; the listing gallery is
        // service_providers.photos. Set both to the matched shot.
        const items = await db.select('service_provider_items', `?provider_id=eq.${e.id}&active=eq.true&order=sort_order.asc&select=id`);
        if (items && items[0]) await db.update('service_provider_items', `?id=eq.${items[0].id}`, { image: key });
        await db.update('service_providers', `?id=eq.${e.id}`, { photos: [key] });
        console.log(`  ✓ ${e.name}  (${e.kw})`);
        await sleep(2000); // be gentle on the image APIs
    }
    for (const id of DEACTIVATE) {
        await db.update('service_providers', `?id=eq.${id}`, { stripe_payouts_enabled: false });
    }
    console.log(`  ✓ deactivated ${DEACTIVATE.length} duplicates (still in the DB, just not eligible)`);

    console.log('— Properties: 8 believable cottages with covers —');
    // A template row supplies every NOT NULL column we don't set ourselves.
    const [tmpl] = await db.select('listings', '?select=*&limit=1');
    if (!tmpl) throw new Error('no template listing to clone');
    const titles = COTTAGES.map((c) => c.title);
    // Idempotent: clear any previous run of these exact demo cottages first.
    await db.remove('listings', `?title=in.(${titles.map((t) => '"' + t.replace(/"/g, '') + '"').join(',')})`).catch(() => {});

    for (const c of COTTAGES) {
        const bytes = await fetchStock('cottage-' + c.slug, c.kw, c.pick);
        const key = await upload(`demo/cottage-${c.slug}.jpg`, bytes);
        await db.insert('listings', [{
            ...tmpl,
            id: undefined, created_at: undefined, updated_at: undefined,
            approx_latitude: undefined, approx_longitude: undefined,
            host_id: tmpl.host_id,
            title: c.title, location: c.town, street_address: c.street, postcode: c.postcode,
            price_per_night: c.price, max_guests: c.guests,
            status: 'published', images: [key], ical_token: crypto.randomUUID(),
            // No fabricated ratings — a fresh listing reads "New".
            rating_avg: null, rating_count: 0,
            rating_cleanliness: null, rating_accuracy: null, rating_checkin: null,
            rating_communication: null, rating_location: null, rating_value: null,
        }]);
        console.log(`  ✓ ${c.title}, ${c.town}  (${c.kw})`);
        await sleep(2000);
    }

    console.log('\nDone. Verify eligible counts:');
    const exp = await db.select('service_providers', "?audience=in.(guest,both)&status=eq.approved&stripe_payouts_enabled=eq.true&select=id");
    const props = await db.select('listings', "?status=eq.published&select=id");
    console.log(`  eligible experiences: ${exp.length}   published properties: ${props.length}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
