import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { COVERAGE_TOWNS } from '@/lib/serviceProviders';
import { logError } from '@/lib/logError';

export const dynamic = 'force-dynamic';

// The provider sign-up wizard's save route (components/services/ProviderSignUp.tsx),
// for experience providers and trades alike. Until now the wizard wrote
// service_providers and its five child tables straight from the browser; every
// write now comes here instead, the way the listing editor saves through
// /api/services/listing/save: read the caller's session with getUser(), confirm
// they own the provider, then write with the service role.
//
// Because the service role skips row security and column grants, THIS FILE is
// the gate. Each table has an allow-list of exactly the columns a signed-in
// provider could write from the browser before (the `authenticated` grants on
// TEST and production, tests/provider-writable-columns-guard.test.ts); anything
// else in the body is dropped, owner_id is always the caller, provider_id is
// always the owned row, and a menu item is only ever updated on its own
// provider. status/submitted_at/review_note are not on any list — moving status
// still goes only through submit_service_provider(), called here with the
// caller's OWN client so its auth.uid() checks (ownership, the name check
// trigger) still run.
//
// Sections, posted as { section, providerId, ... }:
//   row       the service_providers row — inserted on first save (or found, if
//             they already have one in this trade), updated after. Returns the id.
//   children  registrations, extras, prices, coverage areas, the menu. Returns
//             the parts that failed, so the wizard can name them.
//   submit    submit_service_provider() — returns the function's own words on refusal.
//   remove    deletes a DRAFT the caller owns (status matched at the write).

const ROW_WRITABLE = new Set([
    'audience', 'based_line', 'billable_hourly_rate', 'business_name', 'callout_fee',
    'callout_waived', 'collection_postcode', 'collection_street', 'collection_town',
    'contact_email', 'contact_phone', 'covered_bands', 'custom_label', 'declarations',
    'description', 'dietary_note', 'does_emergency', 'does_gas', 'does_oil', 'does_scheduled',
    'exclusive_per_date', 'experience_price', 'flat_fee', 'fulfilment', 'guest_details',
    'headshot', 'hourly_rate', 'lead_time_days', 'logo', 'photos', 'pricing_choice',
    'provider_name', 'provides_quote', 'registration_number', 'shape', 'slot_capacity',
    'slot_length_minutes', 'slot_min_people', 'slot_turnaround_minutes', 'sms_opt_out',
    'trade', 'updated_at',
]);

const ITEM_WRITABLE = [
    'name', 'description', 'price', 'group_price', 'min_hours', 'unit', 'image',
    'duration_minutes', 'fulfilment', 'sort_order', 'active',
];

function pick(obj: any, keys: Iterable<string>): Record<string, any> {
    const out: Record<string, any> = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const k of Array.from(keys)) if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) out[k] = obj[k];
    return out;
}
const str = (v: any) => String(v == null ? '' : v).trim();
// A positive amount, or null — a blank must stay blank, never become £0 (the
// extras price CHECK refuses 0, and 0 would read as a price).
const num = (v: any) => (v != null && String(v).trim() !== '' && Number(v) > 0 ? Number(v) : null);

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const section = str(body.section);
        const admin = adminClient();

        // The owned provider, or null. Every section but a first `row` save needs one.
        const owned = async (id: string) => {
            if (!id) return null;
            const { data } = await admin.from('service_providers')
                .select('id, owner_id, trade, status').eq('id', id).maybeSingle();
            return data && data.owner_id === user.id ? data : null;
        };

        if (section === 'row') {
            const row = pick(body.row, ROW_WRITABLE);
            const trade = str(row.trade);
            if (!trade) return NextResponse.json({ ok: false, error: 'Pick what you do first.' }, { status: 400 });
            row.owner_id = user.id;

            let id = str(body.providerId);
            if (id) {
                if (!(await owned(id))) return NextResponse.json({ ok: false, error: 'Not your listing' }, { status: 403 });
            } else {
                // They may already have a business in this trade — a second tab, or
                // an application started months ago. One per trade is a constraint,
                // so find it rather than collide.
                const { data: already } = await admin.from('service_providers')
                    .select('id').eq('owner_id', user.id).eq('trade', trade).maybeSingle();
                if (already) id = already.id;
            }

            if (id) {
                const { error } = await admin.from('service_providers').update(row).eq('id', id).eq('owner_id', user.id);
                if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
                return NextResponse.json({ ok: true, id });
            }
            const { data, error } = await admin.from('service_providers').insert(row).select('id').single();
            if (error || !data) return NextResponse.json({ ok: false, error: (error && error.message) || 'Could not save that.' }, { status: 400 });
            return NextResponse.json({ ok: true, id: data.id, created: true });
        }

        const provider = await owned(str(body.providerId));
        if (!provider) return NextResponse.json({ ok: false, error: 'Not your listing' }, { status: 403 });
        const id = provider.id;

        if (section === 'submit') {
            // The caller's own client: submit_service_provider() checks auth.uid()
            // owns the row, and the name trigger only runs for a signed-in caller.
            const { error } = await supabase.rpc('submit_service_provider', { p_id: id });
            if (error) return NextResponse.json({ ok: false, error: String(error.message || 'Could not send that.') }, { status: 400 });
            return NextResponse.json({ ok: true });
        }

        if (section === 'remove') {
            // Drafts only — matched at the write too, so a stale screen cannot
            // delete something that has since been sent.
            const { data, error } = await admin.from('service_providers')
                .delete().eq('id', id).eq('owner_id', user.id).eq('status', 'draft').select('id');
            if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
            if (!data || !data.length) return NextResponse.json({ ok: false, error: 'Only a draft can be removed.' }, { status: 409 });
            return NextResponse.json({ ok: true });
        }

        if (section !== 'children') return NextResponse.json({ ok: false, error: 'Unknown section' }, { status: 400 });

        const nowIso = new Date().toISOString();
        const failed: string[] = [];

        // REGISTRATIONS are diffed, not replaced: a row is written only when its
        // number changed, so verified_at on an unchanged Gas Safe number survives
        // an unrelated save. The verified columns are never written here.
        if (Array.isArray(body.registrations)) {
            const wanted = body.registrations
                .map((r: any) => ({ scheme: str(r && r.scheme), number: str(r && r.number) }))
                .filter((r: any) => r.scheme && r.number);
            const { data: have } = await admin.from('service_provider_registrations').select('scheme, number').eq('provider_id', id);
            const wantedSchemes = wanted.map((r: any) => r.scheme);
            const goners = (have || []).map((r: any) => String(r.scheme)).filter((s: string) => wantedSchemes.indexOf(s) === -1);
            if (goners.length) await admin.from('service_provider_registrations').delete().eq('provider_id', id).in('scheme', goners);
            for (const row of wanted) {
                const before = (have || []).filter((r: any) => String(r.scheme) === row.scheme)[0];
                const { error } = !before
                    ? await admin.from('service_provider_registrations').insert({ provider_id: id, scheme: row.scheme, number: row.number, updated_at: nowIso })
                    : str(before.number) !== row.number
                        ? await admin.from('service_provider_registrations').update({ number: row.number, updated_at: nowIso }).eq('provider_id', id).eq('scheme', row.scheme)
                        : { error: null };
                if (error) failed.push('your registration numbers');
            }
        }

        // EXTRAS and PRICES are replaced wholesale — a row that isn't there is a no.
        if (Array.isArray(body.extras)) {
            await admin.from('service_provider_extras').delete().eq('provider_id', id);
            const rows = body.extras.filter((e: any) => e && str(e.extra_key)).map((e: any) => ({
                provider_id: id,
                extra_key: str(e.extra_key),
                offered: true,
                price: num(e.price),
                quote: e.quote === true,
                notes: str(e.notes) || null,
                updated_at: nowIso,
            }));
            if (rows.length) {
                const { error } = await admin.from('service_provider_extras').insert(rows);
                if (error) { console.error('[signup/save] extras insert failed', error); failed.push('your extras'); }
            }
        }
        if (Array.isArray(body.prices)) {
            await admin.from('service_provider_prices').delete().eq('provider_id', id);
            const rows = body.prices.filter((p: any) => p && str(p.band_key) && Number(p.price) > 0).map((p: any) => ({
                provider_id: id,
                band_key: str(p.band_key),
                price: Number(p.price),
                typical_hours: Number(p.typical_hours) > 0 ? Number(p.typical_hours) : null,
                updated_at: nowIso,
            }));
            if (rows.length) {
                const { error } = await admin.from('service_provider_prices').insert(rows);
                if (error) { console.error('[signup/save] prices insert failed', error); failed.push('your prices'); }
            }
        }

        // AREAS are replaced wholesale. The centre comes from the known town list
        // here, not from the browser; a guest region has radius 0.
        if (Array.isArray(body.areas)) {
            await admin.from('service_areas').delete().eq('provider_id', id);
            const rows = body.areas.filter((a: any) => a && str(a.town)).map((a: any) => {
                const town = COVERAGE_TOWNS.filter((t) => t.label === str(a.town))[0];
                return {
                    provider_id: id,
                    label: str(a.town),
                    centre_lat: town ? town.lat : 0,
                    centre_lng: town ? town.lng : 0,
                    radius_miles: Math.max(0, Number(a.radius_miles) || 0),
                };
            });
            if (rows.length) {
                const { error } = await admin.from('service_areas').insert(rows);
                if (error) { console.error('[signup/save] service_areas insert failed', error); failed.push('your coverage areas'); }
            }
        }

        // THE MENU is upserted by id, so an edited row keeps its id (and its
        // photo); only rows taken off the form are deleted. An id is only ever
        // updated when it is already one of THIS provider's items.
        if (Array.isArray(body.items)) {
            const { data: existing } = await admin.from('service_provider_items').select('id').eq('provider_id', id);
            const mine = new Set((existing || []).map((r: any) => String(r.id)));
            const rows = body.items.map((it: any) => ({ id: it && it.id ? String(it.id) : null, ...pick(it, ITEM_WRITABLE), provider_id: id }))
                .filter((r: any) => str(r.name) && Number(r.price) > 0);
            const keep = new Set(rows.map((r: any) => r.id).filter((x: any) => x && mine.has(x)));
            const removed = Array.from(mine).filter((x) => !keep.has(x));
            if (removed.length) await admin.from('service_provider_items').delete().eq('provider_id', id).in('id', removed);
            const toUpdate = rows.filter((r: any) => r.id && mine.has(r.id));
            const toInsert = rows.filter((r: any) => !(r.id && mine.has(r.id))).map(({ id: _omit, ...rest }: any) => rest);
            if (toUpdate.length) {
                const { error } = await admin.from('service_provider_items').upsert(toUpdate);
                if (error) { console.error('[signup/save] items upsert failed', error); failed.push('your prices'); }
            }
            if (toInsert.length) {
                const { error } = await admin.from('service_provider_items').insert(toInsert);
                if (error) { console.error('[signup/save] items insert failed', error); failed.push('your prices'); }
            }
        }

        return NextResponse.json({ ok: true, failed: Array.from(new Set(failed)) });
    } catch (err: any) {
        await logError('services-signup-save', { message: String(err && err.message) });
        return NextResponse.json({ ok: false, error: 'Could not save that. Try again.' }, { status: 500 });
    }
}
