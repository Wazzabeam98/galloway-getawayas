// Make sure every main town has at least one guest experience to show on its
// town page (and on its listings' pages). Idempotent: it only adds a coverage
// circle where a town has none, so it is safe to re-run after a seed reset.
//
// TEST only. It writes service_areas rows with the service-role key from
// .env.local; it never touches production. Run:  node scripts/seed-town-experience-coverage.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { assertTestSupabaseUrl } from './seed-lib.mjs';

const env = Object.fromEntries(
    readFileSync('.env.local', 'utf8')
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL || '';
// The header always said TEST only; until 7 Oct 2026 nothing enforced it —
// any supabase.co URL passed. Now production is refused before a client exists.
assertTestSupabaseUrl(url);
const s = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// The nine main towns the site runs an area page for, with their centres — the
// same list lib/serviceProviders COVERAGE_TOWNS uses.
const TOWNS = [
    { label: 'Kirkcudbright', lat: 54.8362, lng: -4.0530 },
    { label: 'Castle Douglas', lat: 54.9375, lng: -3.9319 },
    { label: 'Gatehouse of Fleet', lat: 54.8797, lng: -4.1836 },
    { label: 'Dumfries', lat: 55.0709, lng: -3.6033 },
    { label: 'Dalbeattie', lat: 54.9350, lng: -3.8200 },
    { label: 'Newton Stewart', lat: 54.9575, lng: -4.4900 },
    { label: 'Moffat', lat: 55.3339, lng: -3.4400 },
    { label: 'Stranraer', lat: 54.9021, lng: -5.0269 },
    { label: 'Wigtown', lat: 54.8686, lng: -4.4425 },
];

function milesBetween(a, b, c, d) {
    const R = 3958.8, r = (x) => (x * Math.PI) / 180;
    const dLat = r(c - a), dLng = r(d - b);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

const RADIUS = 12;

const { data: provs, error } = await s
    .from('service_providers')
    .select('id, business_name, status, based_line, photos, guest_details')
    .eq('status', 'approved');
if (error) { console.error(error.message); process.exit(1); }

// Guest experiences with a hero photo — only these show on the marketplace cards
// AreaExperiences renders, so only these count as "an experience to check".
const guests = (provs || []).filter((p) => p.guest_details && Array.isArray(p.photos) && p.photos.length);
if (!guests.length) { console.error('No guest experiences with a photo found; nothing to seed against.'); process.exit(1); }

const ids = guests.map((p) => p.id);
const { data: areas } = await s.from('service_areas').select('provider_id, centre_lat, centre_lng, radius_miles').in('provider_id', ids);
const byProv = {};
(areas || []).forEach((a) => { (byProv[a.provider_id] ||= []).push(a); });

const covers = (town) => guests.filter((p) => {
    if (p.based_line && p.based_line.toLowerCase().includes(town.label.toLowerCase())) return true;
    return (byProv[p.id] || []).some((c) => milesBetween(Number(c.centre_lat), Number(c.centre_lng), town.lat, town.lng) <= Number(c.radius_miles));
});

// Travelling experiences take the gaps — a chef and a baker who come to you.
// Fall back to any guest experience with a photo so the script still works if
// the seed names change.
const travellers = guests.filter((p) => /Solway Table|Galloway Bakehouse/i.test(p.business_name));
const pool = travellers.length ? travellers : guests;

let added = 0, rr = 0;
for (const town of TOWNS) {
    if (covers(town).length > 0) { console.log(`✓ ${town.label} — already has ${covers(town).length}`); continue; }
    const provider = pool[rr % pool.length]; rr++;
    // Idempotent: skip if this provider already has a circle centred near here.
    const already = (byProv[provider.id] || []).some((c) => milesBetween(Number(c.centre_lat), Number(c.centre_lng), town.lat, town.lng) <= 1);
    if (already) { console.log(`· ${town.label} — circle already present on ${provider.business_name}`); continue; }
    const { error: insErr } = await s.from('service_areas').insert({
        provider_id: provider.id, label: town.label, centre_lat: town.lat, centre_lng: town.lng, radius_miles: RADIUS,
    });
    if (insErr) { console.error(`✗ ${town.label}: ${insErr.message}`); continue; }
    (byProv[provider.id] ||= []).push({ centre_lat: town.lat, centre_lng: town.lng, radius_miles: RADIUS });
    console.log(`+ ${town.label} — added ${RADIUS}mi circle on ${provider.business_name}`);
    added++;
}
console.log(`\nDone. ${added} coverage circle(s) added.`);
