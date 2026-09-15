import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { collectionFieldsForWrite } from '@/lib/serviceProviders';
import { audienceForTrade } from '@/lib/serviceProviders';

export const dynamic = 'force-dynamic';

// The guest-experience listing editor's one save route. Every section of the
// editor posts { providerId, section, data } here and this writes exactly that
// section — so a provider opens one section, changes it, saves it, and nothing
// else is touched. It replaces "edit = re-run the twelve-screen wizard".
//
// Service-role on purpose: some of what a provider legitimately edits is NOT in
// the browser write allow-list (cancellation_window_hours, slot_turnaround_minutes,
// owner_paused). The ownership check here is the real gate — a provider writes
// only their own row — so the route reads the caller's session, confirms they own
// the provider, then writes with the admin client.
//
// Approval is one-time: this route never touches `status`. An approved provider
// edits freely, changes go live immediately, there is no pending state and no
// re-review — the marketplace reads the row as it stands.

async function ownGuestProvider(admin: any, providerId: string, userId: string) {
    const { data: p } = await admin
        .from('service_providers')
        .select('id, owner_id, trade, audience, guest_details, shape, fulfilment')
        .eq('id', providerId)
        .maybeSingle();
    if (!p || p.owner_id !== userId) return null;
    // The editor is the guest-experience surface; a host trade edits elsewhere.
    if (p.audience !== 'guest' && audienceForTrade(p.trade) !== 'guest') return null;
    return p;
}

// A guest_details value a provider typed — trimmed to null so an empty field
// clears rather than storing "" (which reads as "present" to the listing page).
function strOrNull(v: any): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    return s.length ? s : null;
}
function intOrNull(v: any): number | null {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : null;
}

// Merge only the provided keys into guest_details; a key set to null is removed,
// so clearing a field in the editor clears it in the row.
function mergedGuestDetails(current: any, patch: Record<string, any>): Record<string, any> {
    const next = { ...(current && typeof current === 'object' ? current : {}) };
    for (const [k, v] of Object.entries(patch)) {
        if (v == null || (Array.isArray(v) && v.length === 0)) delete next[k];
        else next[k] = v;
    }
    return next;
}

export async function POST(request: Request) {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const providerId = String(body.providerId || '');
        const section = String(body.section || '');
        const data = (body.data && typeof body.data === 'object') ? body.data : {};

        const admin = adminClient();
        const p = await ownGuestProvider(admin, providerId, user.id);
        if (!p) return NextResponse.json({ ok: false, error: 'Not your listing' }, { status: 403 });

        // What to write, per section. Column patches go on `patch`; guest_details
        // keys go on `gd`; child-table replacements are handled inline.
        let patch: Record<string, any> = {};
        let gd: Record<string, any> | null = null;

        switch (section) {
            case 'title':
                patch = { business_name: String(data.business_name || '').trim() };
                break;

            case 'about':
                gd = {
                    professional_title: strOrNull(data.professional_title),
                    years_experience: strOrNull(data.years_experience),
                    qualifications: strOrNull(data.qualifications),
                    recognition: strOrNull(data.recognition),
                };
                break;

            case 'happens':
                gd = {
                    what_to_expect: strOrNull(data.what_to_expect),
                    // Itinerary: the ordered arrival/during/finish phases. A phase is
                    // kept only when it has a detail — an empty phase (a title with no
                    // text) is dropped, so a half-filled flow stores nothing junk.
                    itinerary: Array.isArray(data.itinerary)
                        ? data.itinerary
                            .map((s: any) => ({ title: strOrNull(s?.title), detail: strOrNull(s?.detail) }))
                            .filter((s: any) => s.detail)
                        : [],
                };
                break;

            case 'things':
                gd = {
                    min_age: intOrNull(data.min_age),
                    activity_level: strOrNull(data.activity_level),
                    what_to_bring: strOrNull(data.what_to_bring),
                };
                break;

            case 'dietary':
                patch = { dietary_note: strOrNull(data.dietary_note) };
                gd = {
                    dietary_options: Array.isArray(data.dietary_options)
                        ? data.dietary_options.filter(Boolean)
                        : [],
                };
                break;

            case 'photos':
                // The guard against vanishing (no photo → dropped from every grid)
                // lives in the editor UI as a warning; the row is still allowed to
                // save, so a provider mid-edit isn't blocked. Store keys as given.
                patch = {
                    photos: Array.isArray(data.photos) ? data.photos.filter(Boolean) : [],
                    headshot: strOrNull(data.headshot),
                    logo: strOrNull(data.logo),
                };
                break;

            case 'where': {
                const fulfilment = strOrNull(data.fulfilment);
                patch = { fulfilment };
                const collects = fulfilment === 'collection' || fulfilment === 'both';
                const cols = collectionFieldsForWrite({
                    collects, loaded: true,
                    street: data.collection_street || '', town: data.collection_town || '', postcode: data.collection_postcode || '',
                });
                if (cols) patch = { ...patch, ...cols };
                // Coverage regions: replace the set.
                if (Array.isArray(data.areas)) {
                    await admin.from('service_areas').delete().eq('provider_id', providerId);
                    const rows = data.areas.map((label: any) => strOrNull(label)).filter(Boolean)
                        .map((label: string) => ({ provider_id: providerId, label }));
                    if (rows.length) await admin.from('service_areas').insert(rows);
                }
                break;
            }

            case 'availability': {
                patch = {
                    slot_length_minutes: intOrNull(data.slot_length_minutes),
                    slot_turnaround_minutes: Math.max(0, Math.floor(Number(data.slot_turnaround_minutes) || 0)),
                    slot_capacity: intOrNull(data.slot_capacity),
                    slot_min_people: Math.max(1, Math.floor(Number(data.slot_min_people) || 1)),
                    lead_time_days: Math.max(0, Math.floor(Number(data.lead_time_days) || 0)),
                    cancellation_window_hours: Math.max(0, Math.floor(Number(data.cancellation_window_hours) || 0)),
                };
                // Weekly hours template: replace. Dated exceptions (days off, partial
                // blocks) stay in the diary — not touched here.
                if (Array.isArray(data.availability)) {
                    await admin.from('slot_availability').delete().eq('provider_id', providerId);
                    const rows = data.availability
                        .filter((r: any) => r && r.open_time && r.close_time)
                        .map((r: any) => ({
                            provider_id: providerId,
                            day_of_week: Math.max(0, Math.min(6, Math.floor(Number(r.day_of_week) || 0))),
                            open_time: r.open_time, close_time: r.close_time,
                        }));
                    if (rows.length) await admin.from('slot_availability').insert(rows);
                }
                break;
            }

            case 'menu': {
                // The menu — UPSERTED BY ID, never deleted-and-reinserted, so an
                // item keeps its id (bookings and its photo reference it). Only a
                // named, priced row persists (the marketplace lists priced items
                // only); a blank row is dropped, and an existing item removed from
                // the list is deleted. The last-priced-item guard is a UI warning —
                // the route still honours an empty menu (the provider was warned).
                const incoming: any[] = Array.isArray(data.items) ? data.items : [];
                const { data: existing } = await admin.from('service_provider_items').select('id').eq('provider_id', providerId);
                const existingIds = new Set((existing || []).map((r: any) => r.id));
                const keep = new Set<string>();
                const nowIso = new Date().toISOString();
                // Per-item location only exists for a slot provider who offers BOTH
                // (studio and travelled). Each item is then 'collection' (at their
                // place) or 'delivery' (travels to the guest); everyone else's items
                // inherit (null). A travelling item is a private, whole-cottage hire,
                // so its unit is forced to 'flat' — the same rule the wizard applies.
                const perItemLocation = p.shape === 'slot' && p.fulfilment === 'both';
                for (let i = 0; i < incoming.length; i++) {
                    const it = incoming[i];
                    const name = String(it.name || '').trim();
                    const price = Number(it.price);
                    if (!name || !(price > 0)) continue; // a blank / priceless row
                    const itemFulfilment = perItemLocation
                        ? (String(it.fulfilment) === 'delivery' ? 'delivery' : 'collection')
                        : null;
                    const unit = (perItemLocation && itemFulfilment === 'delivery')
                        ? 'flat' : String(it.unit || 'flat');
                    const row: any = {
                        name, description: strOrNull(it.description), price,
                        unit,
                        image: strOrNull(it.image),
                        duration_minutes: (it.duration_minutes == null || it.duration_minutes === '')
                            ? null : Math.max(1, Math.floor(Number(it.duration_minutes))),
                        fulfilment: itemFulfilment,
                        active: it.active !== false,
                        sort_order: i, updated_at: nowIso,
                    };
                    if (it.id && existingIds.has(it.id)) {
                        keep.add(it.id);
                        await admin.from('service_provider_items').update(row).eq('id', it.id).eq('provider_id', providerId);
                    } else {
                        const { data: ins } = await admin.from('service_provider_items')
                            .insert({ ...row, provider_id: providerId }).select('id').maybeSingle();
                        if (ins?.id) keep.add(ins.id);
                    }
                }
                const remove = Array.from(existingIds).filter((id) => !keep.has(id as string));
                if (remove.length) await admin.from('service_provider_items').delete().in('id', remove).eq('provider_id', providerId);
                break;
            }

            case 'status':
                // The take-down toggle. Hides the listing and stops new bookings;
                // confirmed bookings already made are untouched (nothing here
                // cancels them). Coming back is immediate — no re-review.
                patch = { owner_paused: data.owner_paused === true };
                break;

            default:
                return NextResponse.json({ ok: false, error: `Unknown section: ${section}` }, { status: 400 });
        }

        if (gd) patch.guest_details = mergedGuestDetails(p.guest_details, gd);
        patch.updated_at = new Date().toISOString();

        const { error } = await admin.from('service_providers').update(patch).eq('id', providerId);
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message || 'Could not save' }, { status: 500 });
    }
}
