// The marketplace's data, in one place, so the grid page, a provider's listing
// page and the /api/services/experiences endpoint all show the same answer.
//
// Server-only: it is handed an admin (service-role) client and does the reads.
// Eligibility is unchanged — approved, payouts on, an assigned MCC, at least one
// priced item, and covering the cottage — with shape and, for a slot provider,
// the bookable sessions inside the stay folded in.

import { isLiveToGuests, mccForProvider, isFoodProvider, normaliseUnit } from '@/lib/serviceOrders';
import { guestCategory, knownDietaryOptions, knownExperienceAmenities } from '@/lib/serviceProviders';
import { shapeOf, generateSessions, sessionClosedToAll, minutesOfDay, type PartialBlock } from '@/lib/serviceSlots';
import { getImageUrl, firstName } from '@/lib/utils';
import { shiftDayKey, londonDayKey } from '@/lib/dayKey';

export interface MpItem {
    id: string; name: string; description: string | null; price: number; unit: string; image: string | null;
    // The per-treatment length in minutes (massage: 30/45/60/90), or null for a
    // single-length category (sauna, a class), where the provider's slot length is
    // used. When any item carries one, the times a guest sees depend on the item.
    duration_minutes: number | null;
    // Per-item location for a 'both' provider: 'delivery' = travelled to the guest
    // (private, capped only by the cottage), 'collection' = at the provider's
    // place, null = inherit the provider's single answer.
    fulfilment: string | null;
    // Per-item seats and minimum (per-person items only). null = fall back to the
    // provider's slot_capacity / slot_min_people — the phased override. The panel
    // resolves these through seatConfig(), the SAME function the book route uses,
    // so the display and the enforcement never read a different number.
    capacity: number | null;
    minPeople: number | null;
}
// A booked session's interval on the provider's day, for greying overlapping
// starts client-side: the same rule the claim and the DB exclusion enforce. Also
// carries the seat state, so a mixed provider's shared CLASS (capacity > 1) reads
// its real seats-left rather than being treated as a full one-seat slot.
export interface MpBookedBlock {
    date: string; time: string; duration_minutes: number | null; turnaround_minutes: number | null;
    capacity: number; seats_taken: number; private: boolean;
}
export interface MpSession {
    date: string; time: string;
    // The established slot_sessions row for this time, or null if nobody has
    // booked it yet (a fresh time — open to any option). The panel reads
    // optionAvailability off this, per option, so a private hire and a shared
    // seat show their OWN availability rather than one shared "seats left".
    row: { capacity: number; seats_taken: number; private: boolean } | null;
}
export interface MpProvider {
    id: string;
    // The listing's display name is the provider's Title (their Intro field).
    business_name: string;
    // The byline beneath their photo: the provider's FIRST name only, derived
    // live from their profile (honouring the show_full_name / preferred_name
    // switch). A surname must never reach a guest, so this is not provider_name
    // (a stored snapshot that could carry one). Empty when they have no shown name.
    byline: string;
    provider_name: string | null;
    based_line: string | null;
    headshot: string | null;
    category: string;
    // A food business (chef, baker, hamper, prepared meals) — the booking
    // panel asks these for allergies specifically.
    isFood: boolean;
    // What a food business can cater for, in their own words; null when they
    // haven't said, which the listing shows plainly rather than staying silent.
    dietary_note: string | null;
    // What the provider can cater for, as keys (DIETARY_OPTIONS), from
    // guest_details jsonb. Shown as chips; the note carries the caveats.
    dietary_options: string[];
    // The person's professional title ("Chef and restaurant owner"), from
    // guest_details jsonb. Shown as a credential in the "About {first name}"
    // block, beneath the listing name (which is business_name / the h1 now). The
    // listing page dedupes it against business_name so a provider who predates the
    // listing-title question — whose business_name is still their professional
    // title — doesn't show the same words as both the h1 and the credential.
    professional_title: string | null;
    // The person, in their own words — the credibility layer collected at sign-up
    // and, until now, never shown. All from guest_details jsonb; all guest-safe by
    // design (a qualification is; a surname is not, and none of these carry one).
    //   qualifications  — training/certificates ("required" for the safety four)
    //   recognition     — endorsements, a press mention (always optional)
    //   yearsExperience — the bare years number, as they typed it ("30")
    qualifications: string | null;
    recognition: string | null;
    yearsExperience: string | null;
    // The largest group a non-slot provider will take (guest_details.max_guests),
    // for a "Good to know" line. A slot sizes seats from slot_capacity instead, so
    // this is null there. Null when they never answered.
    maxGuests: number | null;
    // The provider's own gallery — the dedicated "show guests what it looks like"
    // photos step (service_providers.photos), which the listing leads on. These
    // are the hero shots; item images supplement them. Storage keys resolved to
    // URLs. Empty for a legacy row that predates the photos step.
    photos: string[];
    // The gallery as RAW storage keys (provider photos first, then item images,
    // deduped) — for the shared PhotoGallery, which resolves keys itself (so the
    // experience mosaic is the same component, and the same craft, as a cottage
    // listing's). `photos` above stays resolved for the card hero.
    galleryKeys: string[];
    // The provider's own walk-through of the experience, from guest_details jsonb.
    // Displayed on the experience page; null when they didn't write one.
    what_happens: string | null;
    // The ordered flow — arrival / during / finish — from guest_details.itinerary.
    // Each phase carries a title and the provider's detail; empty when unset.
    itinerary: Array<{ title: string; detail: string }>;
    // "Things to know", from guest_details — essential facts a guest needs before
    // booking. Null/absent when the provider hasn't set them.
    minAge: number | null;
    activityLevel: string | null;
    whatToBring: string | null;
    // Optional practical facts a provider can add. Accessibility matters most —
    // a guest who needs it really needs it — so it leads. Null when unset.
    accessibility: string | null;
    parking: string | null;
    // What's included, as a sanitised list of amenity keys — drives the guest
    // listing's "What's included" section. Empty for a provider who ticked none.
    amenities: string[];
    // Non-refundable once booked — the "No refund" cancellation policy. The
    // window (cancellation_window_hours) still describes the refundable ones.
    noRefund: boolean;
    description: string | null;
    shape: string;
    // The fulfilment direction: 'delivery' = the provider travels to the guest's
    // cottage (a travelling session, which needs a destination address),
    // 'collection'/null = come-to-me. Lets the panel ask a travelling session for
    // the stay it should come to.
    fulfilment: string | null;
    priceFrom: number;
    // A slot provider's per-person vs whole-slot reading comes off the item unit.
    items: MpItem[];
    // Slots only: the next bookable sessions in the stay (future, seats left).
    sessions: MpSession[];
    // Per-person slots only: the smallest group a single booking may be
    // (slot_min_people). 1 = no minimum. The panel floors the picker at it; the
    // booking route enforces it for real. Meaningless when the unit doesn't
    // multiply (a whole-group flat price is one booking) — 1 there.
    minPeople: number;
    // Slots only: the whole-table size (slot_capacity), so the panel can size a
    // per-person option on a FRESH time (no row yet) via the shared helper. 0 when
    // not a slot or unset.
    slotCapacity: number;
    // The per-treatment shape: true when any item carries its own duration, so the
    // panel generates the grid from the chosen treatment's length rather than one
    // provider number. False for sauna/class/tasting — the fixed-grid shape.
    perItemDurations: boolean;
    // The provider's reset gap, folded into the blocking interval (not the shown
    // duration). 0 for everyone who hasn't set one.
    turnaround: number;
    // The weekly template and blocked dates, so the panel can generate the chosen
    // treatment's grid client-side (the same generateSessions the server uses).
    slotAvailability: Array<{ day_of_week: number; open_time: string; close_time: string }>;
    slotBlocks: string[];
    // Partial blocks — ranges within a day the provider closed off. The panel
    // drops any start they cover, the same rule the database enforces.
    partialBlocks: PartialBlock[];
    // Every booked session's interval, so the panel greys any start that would
    // overlap one — the guest never sees, or picks, a time the claim would refuse.
    bookedBlocks: MpBookedBlock[];
    // The provider's single session length (minutes), the fallback for an untimed
    // item. 0 when unset (a pure one-at-a-time provider) or not a slot.
    slotLength: number;
    cancellation_window_hours: number;
    // Made-to-order only: notice needed, in days — gates the earliest bookable date.
    lead_time_days: number;
    hero: string | null;
    // The regions this provider covers, in their own words — a line on the card.
    // Informational since coverage stopped filtering; empty for a provider who
    // predates the region picker.
    areas: string[];
    // A rough map coordinate — the coverage-area centre (town scale), shown as a
    // "roughly here" pin on a fixed venue's listing. Never the exact address.
    mapLat: number | null;
    mapLng: number | null;
    // The only honest trust signal we can show today: how many confirmed
    // bookings this provider has taken through the site. Zero reads as "New
    // here" on the card rather than as nothing — a stranger booking a chef into
    // their cottage deserves to know which it is. (There are no provider reviews
    // yet; when there are, they lead and this becomes the secondary line.)
    bookingsCount: number;
}

export interface Marketplace {
    open: boolean;
    stay: { check_in: string; check_out: string; guests: number } | null;
    listing: { id: string; title: string | null; location: string | null } | null;
    providers: MpProvider[];
}

function staySpan(b: any) { return { check_in: b.check_in, check_out: b.check_out, guests: Math.max(1, Number(b.guests) || 1) }; }

// A guest_details value that a provider typed in a free-text field — trimmed, or
// null when they left it blank (an empty string reads as "present" to the page
// and would render an empty heading). Numbers (years, entered as text) are
// stringified so "30" and 30 both survive.
function strOrNull(v: any): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    return s.length ? s : null;
}
// A positive integer from a text field (max_guests), or null. 0/blank/garbage → null.
function intOrNull(v: any): number | null {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : null;
}

// yyyy-mm-dd of the last night (check_out is the morning they leave).
function lastNightKey(checkOut: string): string {
    return shiftDayKey(String(checkOut).slice(0, 10), -1);
}

/**
 * The eligible providers for a booking (the guest's own), each with its shape,
 * menu and — for a slot — the bookable sessions inside the stay. `open` is the
 * launch flag; when it is false, providers is empty.
 */
export async function loadMarketplace(
    admin: any,
    userId: string,
    bookingId: string,
    open: boolean
): Promise<Marketplace> {
    if (!open) return { open: false, stay: null, listing: null, providers: [] };

    const { data: booking } = await admin
        .from('bookings')
        .select('id, guest_id, listing_id, check_in, check_out, guests')
        .eq('id', bookingId)
        .maybeSingle();
    if (!booking || booking.guest_id !== userId) return { open: true, stay: null, listing: null, providers: [] };

    const { data: listing } = await admin
        .from('listings').select('id, title, location, latitude, longitude').eq('id', booking.listing_id).maybeSingle();
    if (!listing) return { open: true, stay: staySpan(booking), listing: null, providers: [] };

    const providers = await shapeProviders(admin, booking.check_in.slice(0, 10), lastNightKey(booking.check_out));
    return { open: true, stay: staySpan(booking), listing: { id: listing.id, title: listing.title, location: listing.location }, providers };
}

// The CEILING on how far ahead a bookingless browse looks — the most any
// provider is allowed to open. Each provider caps its own window below this with
// its booking horizon (guest_details.booking_horizon_days); a stay bounds the
// against-a-cottage path tighter still. Kept generous so a provider can choose a
// long horizon; generateSessions only walks up to each provider's own cap, so
// the ceiling costs nothing for providers who set less.
const PUBLIC_HORIZON_DAYS = 365;
// What a provider's horizon defaults to when they haven't set one — the season
// ahead the standalone browse always showed.
const DEFAULT_BOOKING_HORIZON_DAYS = 90;

/**
 * The bookingless (public / standalone) marketplace: everyone can browse without
 * a stay. Same eligibility and the same provider shaping as the against-a-stay
 * path (shapeProviders), so a listing reads identically whichever way it was
 * reached; only the date range differs — from today to a horizon, not a stay
 * window — and there is no stay/listing/guest attached. Identity, the date, the
 * head count and (for a travelling shape) the address are supplied at checkout,
 * behind a sign-in, rather than taken from a booking.
 */
export async function loadPublicMarketplace(
    admin: any,
    open: boolean,
    horizonDays: number = PUBLIC_HORIZON_DAYS
): Promise<Marketplace> {
    if (!open) return { open: false, stay: null, listing: null, providers: [] };
    const fromKey = londonDayKey(new Date());
    const toKey = shiftDayKey(fromKey, Math.max(1, horizonDays));
    const providers = await shapeProviders(admin, fromKey, toKey);
    return { open: true, stay: null, listing: null, providers };
}

/**
 * Fetch every eligible guest provider and shape it for the marketplace over the
 * date window [fromKey, toKey] — the ONLY thing that differs between the
 * against-a-stay and the standalone paths. Booking-free: it knows nothing about a
 * stay, a listing or a guest, so the two callers can't drift apart on
 * eligibility, pricing, seat availability or privacy.
 */
async function shapeProviders(admin: any, fromKey: string, toKey: string): Promise<MpProvider[]> {
    const { data: rows } = await admin
        .from('service_providers')
        .select('id, owner_id, business_name, provider_name, based_line, headshot, photos, trade, custom_label, stripe_mcc, description, status, stripe_payouts_enabled, owner_paused, shape, slot_length_minutes, slot_turnaround_minutes, slot_capacity, slot_min_people, cancellation_window_hours, lead_time_days, dietary_note, guest_details, fulfilment')
        .eq('audience', 'guest').eq('status', 'approved').eq('stripe_payouts_enabled', true).eq('owner_paused', false);

    const ids = (rows || []).map((r: any) => r.id);
    if (!ids.length) return [];

    // The byline (first name) comes from the owner's profile, live, so it tracks
    // the name and the show_full_name switch rather than a stored snapshot.
    const ownerIds = Array.from(new Set((rows || []).map((r: any) => r.owner_id).filter(Boolean)));
    const { data: ownerProfiles } = ownerIds.length
        ? await admin.from('profiles').select('id, full_name, preferred_name, show_full_name').in('id', ownerIds)
        : { data: [] as any[] };
    const profileById: Record<string, any> = {};
    for (const pr of ownerProfiles || []) profileById[pr.id] = pr;

    const [{ data: areas }, { data: itemRows }, { data: avail }, { data: blocks }, { data: sessRows }, { data: orderRows }] = await Promise.all([
        admin.from('service_areas').select('provider_id, label, centre_lat, centre_lng').in('provider_id', ids),
        admin.from('service_provider_items').select('id, provider_id, name, description, price, unit, image, sort_order, created_at, duration_minutes, fulfilment, capacity, min_people')
            .in('provider_id', ids).eq('active', true).gt('price', 0)
            .order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
        admin.from('slot_availability').select('provider_id, day_of_week, open_time, close_time').in('provider_id', ids),
        admin.from('slot_blocks').select('provider_id, blocked_date').in('provider_id', ids),
        admin.from('slot_sessions').select('provider_id, session_date, session_time, capacity, seats_taken, private, duration_minutes, turnaround_minutes, blocked, is_class').in('provider_id', ids),
        // Confirmed bookings taken, for the trust count. Only 'confirmed' counts:
        // a held request that was never answered, or one that was cancelled or
        // refunded, is not a booking someone completed with this provider.
        admin.from('service_orders').select('provider_id, status').in('provider_id', ids).eq('status', 'confirmed'),
    ]);

    const by = <T,>(list: any[], key: string) => {
        const m: Record<string, T[]> = {};
        for (const r of list || []) (m[r[key]] = m[r[key]] || []).push(r);
        return m;
    };
    const areasBy = by<any>(areas, 'provider_id');
    const itemsBy = by<any>(itemRows, 'provider_id');
    const bookingsCountBy: Record<string, number> = {};
    for (const o of orderRows || []) bookingsCountBy[o.provider_id] = (bookingsCountBy[o.provider_id] || 0) + 1;
    const availBy = by<any>(avail, 'provider_id');
    const blocksBy = by<any>(blocks, 'provider_id');
    const sessBy = by<any>(sessRows, 'provider_id');

    const nowMs = Date.now();

    const providers: MpProvider[] = [];
    for (const p of rows || []) {
        if (!(isLiveToGuests(p) && mccForProvider(p))) continue;
        const items = (itemsBy[p.id] || []).map((it: any) => ({
            id: it.id, name: it.name, description: it.description, price: Number(it.price),
            unit: normaliseUnit(it.unit), image: it.image ? getImageUrl(it.image) : null,
            duration_minutes: it.duration_minutes == null ? null : Number(it.duration_minutes),
            fulfilment: it.fulfilment || null,
            capacity: it.capacity == null ? null : Number(it.capacity),
            minPeople: it.min_people == null ? null : Number(it.min_people),
        }));
        if (!items.length) continue;
        const perItemDurations = items.some((it: MpItem) => it.duration_minutes != null && it.duration_minutes > 0);
        const turnaround = Math.max(0, Number(p.slot_turnaround_minutes) || 0);

        const shape = shapeOf(p);
        let sessions: MpSession[] = [];
        let providerPartialBlocks: PartialBlock[] = [];
        if (shape === 'slot') {
            // The pinned seat row for a (date,time), if anyone has booked it. A
            // fresh time has none and is open to any option. Whichever option
            // established a time also pinned its capacity and mode, so the row is
            // read as-is — not recomputed from one item's unit, which was the old
            // bug (it sized every time by items[0] and ignored the mode).
            const rowByKey: Record<string, { capacity: number; seats_taken: number; private: boolean }> = {};
            for (const s of sessBy[p.id] || []) {
                // session_time comes back from the time column as "HH:MM:SS";
                // generateSessions keys are "HH:MM", so normalise or the row never
                // matches its generated time and a booked slot reads as empty.
                rowByKey[s.session_date + ' ' + String(s.session_time).slice(0, 5)] = {
                    capacity: Number(s.capacity), seats_taken: Number(s.seats_taken), private: Boolean(s.private),
                };
            }
            // Partial blocks: the provider's blocked rows become [start,end) ranges
            // the grid skips, so a closed-off part of a day never shows a start.
            // A DECLARED CLASS (is_class) reserves its interval the same way for the
            // OPEN-HOURS grid — a private hour can't be offered on top of an
            // announced class (the database refuses it either way; this stops it
            // ever being shown). The class itself becomes bookable through its own
            // timetable lane, not here. Its interval includes the frozen reset gap,
            // matching what the DB's block_minutes reserves.
            providerPartialBlocks = (sessBy[p.id] || [])
                .filter((s: any) => s.blocked || s.is_class)
                .map((s: any) => {
                    const startMin = minutesOfDay(String(s.session_time).slice(0, 5));
                    const span = (Number(s.duration_minutes) || 0) + (s.is_class ? (Number(s.turnaround_minutes) || 0) : 0);
                    return { date: s.session_date, startMin, endMin: startMin + span };
                });
            const closedItems = items.map((it: MpItem) => ({ unit: it.unit, capacity: it.capacity, min_people: it.minPeople }));
            // The provider's own booking horizon caps how far ahead its sessions
            // are generated — never past the window it was handed (a stay, or the
            // browse ceiling), never past its own horizon. So a provider open only
            // 30 days out stops there even on the season-long standalone browse.
            const horizon = Math.max(1, Math.min(
                PUBLIC_HORIZON_DAYS,
                intOrNull(p.guest_details && p.guest_details.booking_horizon_days) ?? DEFAULT_BOOKING_HORIZON_DAYS,
            ));
            const provHorizonKey = shiftDayKey(fromKey, horizon);
            const provToKey = provHorizonKey < toKey ? provHorizonKey : toKey;
            sessions = generateSessions(
                (availBy[p.id] || []).map((a: any) => ({ day_of_week: a.day_of_week, open_time: a.open_time, close_time: a.close_time })),
                (blocksBy[p.id] || []).map((b: any) => b.blocked_date),
                Number(p.slot_length_minutes) || 60, fromKey, provToKey,
                undefined, providerPartialBlocks,
            )
                .filter((s) => new Date(s.date + 'T' + s.time + ':00Z').getTime() > nowMs)
                .map((s) => ({ date: s.date, time: s.time, row: rowByKey[s.date + ' ' + s.time] || null }))
                // Drop a time only when it is closed to EVERY option this provider
                // offers (a private hire taken, or a shared table too full for its
                // minimum). A time still bookable by SOME option stays — the panel
                // greys the options it isn't bookable by, per the shared helper.
                .filter((s) => !sessionClosedToAll(s.row, closedItems, p));
            // A slot with no bookable session in the stay is not shown.
            if (!sessions.length) continue;
        }

        providers.push({
            id: p.id,
            business_name: p.business_name,
            byline: firstName(profileById[p.owner_id] || null, ''),
            provider_name: p.provider_name,
            based_line: p.based_line,
            headshot: p.headshot ? getImageUrl(p.headshot) : null,
            category: guestCategory(p),
            isFood: isFoodProvider(p),
            dietary_note: p.dietary_note || null,
            dietary_options: knownDietaryOptions((p.guest_details && Array.isArray(p.guest_details.dietary_options)) ? p.guest_details.dietary_options : []),
            professional_title: (p.guest_details && p.guest_details.professional_title) || null,
            qualifications: (p.guest_details && strOrNull(p.guest_details.qualifications)) || null,
            recognition: (p.guest_details && strOrNull(p.guest_details.recognition)) || null,
            yearsExperience: (p.guest_details && strOrNull(p.guest_details.years_experience)) || null,
            maxGuests: shape === 'slot' ? null : intOrNull(p.guest_details && p.guest_details.max_guests),
            photos: Array.isArray(p.photos) ? p.photos.filter(Boolean).map((k: string) => getImageUrl(k)) : [],
            galleryKeys: Array.from(new Set([
                ...(Array.isArray(p.photos) ? p.photos.filter(Boolean) : []),
                ...(itemsBy[p.id] || []).map((it: any) => it.image).filter(Boolean),
            ])) as string[],
            what_happens: (p.guest_details && p.guest_details.what_to_expect) || null,
            itinerary: (p.guest_details && Array.isArray(p.guest_details.itinerary))
                ? p.guest_details.itinerary
                    .map((s: any) => ({ title: String(s?.title || '').trim(), detail: String(s?.detail || '').trim() }))
                    .filter((s: any) => s.detail)
                : [],
            minAge: intOrNull(p.guest_details && p.guest_details.min_age),
            activityLevel: (p.guest_details && strOrNull(p.guest_details.activity_level)) || null,
            whatToBring: (p.guest_details && strOrNull(p.guest_details.what_to_bring)) || null,
            accessibility: (p.guest_details && strOrNull(p.guest_details.accessibility)) || null,
            parking: (p.guest_details && strOrNull(p.guest_details.parking)) || null,
            amenities: knownExperienceAmenities(p.guest_details && p.guest_details.amenities),
            noRefund: !!(p.guest_details && p.guest_details.no_refund),
            description: p.description,
            shape,
            fulfilment: p.fulfilment || null,
            priceFrom: Math.min(...items.map((i: MpItem) => i.price)),
            items,
            sessions,
            // The per-person minimum for the whole slot (the helper applies it only
            // to a per-person option, so it is safe to pass for a 'both' provider
            // whose items[0] happens to be the flat one).
            minPeople: shape === 'slot' ? Math.max(1, Number(p.slot_min_people) || 1) : 1,
            slotCapacity: shape === 'slot' ? Math.max(0, Number(p.slot_capacity) || 0) : 0,
            perItemDurations: shape === 'slot' ? perItemDurations : false,
            turnaround: shape === 'slot' ? turnaround : 0,
            slotAvailability: shape === 'slot'
                ? (availBy[p.id] || []).map((a: any) => ({ day_of_week: a.day_of_week, open_time: a.open_time, close_time: a.close_time }))
                : [],
            slotBlocks: shape === 'slot' ? (blocksBy[p.id] || []).map((b: any) => b.blocked_date) : [],
            partialBlocks: providerPartialBlocks,
            bookedBlocks: shape === 'slot'
                ? (sessBy[p.id] || [])
                    .filter((s: any) => Number(s.seats_taken) > 0)
                    .map((s: any) => ({
                        date: s.session_date,
                        time: String(s.session_time).slice(0, 5),
                        duration_minutes: s.duration_minutes == null ? null : Number(s.duration_minutes),
                        turnaround_minutes: s.turnaround_minutes == null ? null : Number(s.turnaround_minutes),
                        capacity: Number(s.capacity), seats_taken: Number(s.seats_taken), private: Boolean(s.private),
                    }))
                : [],
            // The one provider session length, for the panel to fall an UNTIMED
            // item (a shared class) back onto — a mixed provider's classes use it
            // while its 1:1s carry their own. 0 for a pure one-at-a-time provider
            // (massage stores none) and for non-slots.
            slotLength: shape === 'slot' ? Math.max(0, Number(p.slot_length_minutes) || 0) : 0,
            cancellation_window_hours: Number(p.cancellation_window_hours) || 48,
            lead_time_days: Number(p.lead_time_days) || 0,
            hero: (items.find((i: MpItem) => i.image) || {}).image || null,
            areas: (areasBy[p.id] || []).map((a: any) => a.label).filter(Boolean),
            mapLat: (() => { const c = (areasBy[p.id] || []).find((a: any) => a.centre_lat != null); return c ? Number(c.centre_lat) : null; })(),
            mapLng: (() => { const c = (areasBy[p.id] || []).find((a: any) => a.centre_lng != null); return c ? Number(c.centre_lng) : null; })(),
            bookingsCount: bookingsCountBy[p.id] || 0,
        });
    }

    // A gentle order: the ones with a photo first (the shop window sells on
    // them), then by name, so the grid never opens on a wall of placeholders.
    providers.sort((a, b) => {
        const ah = a.hero ? 0 : 1, bh = b.hero ? 0 : 1;
        return ah !== bh ? ah - bh : a.business_name.localeCompare(b.business_name);
    });

    return providers;
}

/** One provider from a marketplace load, or null. */
export function pickProvider(mp: Marketplace, providerId: string): MpProvider | null {
    return mp.providers.find((p) => p.id === providerId) || null;
}
