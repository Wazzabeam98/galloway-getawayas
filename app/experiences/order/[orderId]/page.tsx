import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, CalendarDays, MapPin, CheckCircle2, Clock3, XCircle, AlertTriangle,
    MessageSquare, ChevronRight, Navigation, LifeBuoy, BookOpen, Award,
} from 'lucide-react';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { firstName, getImageUrl } from '@/lib/utils';
import { guestMayCancelFree } from '@/lib/serviceSlots';
import { orderLocation } from '@/lib/orderLocation';
import { isFoodProvider } from '@/lib/serviceOrders';
import { cancellationSentence, yearsLabel } from '@/components/marketplace/present';
import OrderCancel from '@/components/marketplace/OrderCancel';
import PropertyMap from '@/components/PropertyMap';
import { CopyAddressRow, PrintDetailsRow } from '@/components/marketplace/OrderUtilityRows';

export const dynamic = 'force-dynamic';

// A booked experience, as a page.
//
// Restyled in September 2026 against Airbnb's real post-booking reservation
// screen, walked in a browser rather than recalled: a NARROW scrolling column
// beside a sticky map, with actions as quiet chevron rows instead of a bank of
// buttons. What was copied, what was deliberately not, and where the product
// genuinely differs is written up in the pull request.
//
// The map is a VARIANT, not the base. It earns its place only when there is a
// fixed venue to find — a come-to-me session, a bakery to collect from. A chef
// coming to the cottage and a cake made for a date have no venue, so those
// render as a full-width column with no map and no directions rows.

const STATUS: Record<string, { label: string; tone: 'ok' | 'wait' | 'over' }> = {
    confirmed: { label: 'Confirmed', tone: 'ok' },
    authorised: { label: 'Waiting to be confirmed', tone: 'wait' },
    holding: { label: 'Holding your place', tone: 'wait' },
    declined: { label: 'The provider couldn’t make it', tone: 'over' },
    expired: { label: 'Expired — no reply in time', tone: 'over' },
    cancelled: { label: 'Cancelled', tone: 'over' },
    refunded: { label: 'Cancelled and refunded', tone: 'over' },
};
const PILL: Record<string, string> = {
    ok: 'bg-emerald-100 text-emerald-800',
    wait: 'bg-amber-100 text-amber-800',
    over: 'bg-slate-200 text-slate-600',
};

// One definition of a chevron row, shared by the server-rendered link rows here
// and the two browser-action rows in OrderUtilityRows, so the quiet-row pattern
// cannot grow a second variant.
const ROW = 'flex w-full items-center justify-between gap-3 py-3 text-left text-sm font-medium text-slate-800 hover:text-slate-950';

function longWhen(dateStr: string, timeStr: string | null): string {
    const d = new Date(dateStr + 'T00:00:00');
    const day = isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!timeStr) return day;
    const [h, m] = timeStr.split(':').map(Number);
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = ((h + 11) % 12) + 1;
    return day + ' at ' + h12 + (m ? ':' + String(m).padStart(2, '0') : '') + ampm;
}

// Short day/time pieces for the Starts / Ends box, which Airbnb renders as two
// stacked columns rather than a sentence.
function shortDay(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function clock(timeStr: string): string {
    const [h, m] = timeStr.split(':').map(Number);
    return String(h).padStart(2, '0') + ':' + String(m || 0).padStart(2, '0');
}
function endClock(timeStr: string, durationMin: number): string {
    const [h, m] = timeStr.split(':').map(Number);
    const end = h * 60 + m + (durationMin || 60);
    return String(Math.floor(end / 60) % 24).padStart(2, '0') + ':' + String(end % 60).padStart(2, '0');
}

// "In 1 week" — the badge Airbnb puts on the photo. Null once the date is past,
// so a finished booking doesn't claim to be upcoming.
function untilBadge(dateStr: string): string | null {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (days < 0) return null;
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 7) return `In ${days} days`;
    const weeks = Math.floor(days / 7);
    if (weeks === 1) return 'In 1 week';
    if (weeks < 9) return `In ${weeks} weeks`;
    return null;
}

// An .ics the guest can drop into their calendar. A slot has a real time, so it
// is a timed event; a made-to-order/comes-to-you booking is a date, so it is an
// all-day event. Floating local time (no Z) is what a guest expects — 2pm is 2pm
// wherever their phone is. Returned as a data: URL so a plain <a download> saves
// it with no round trip.
//
// Airbnb has no add-to-calendar anywhere on this screen. Kept deliberately: a
// 90-minute appointment in someone else's diary is worth more to a guest than
// it is to a platform whose app already holds the trip.
function calendarHref(opts: { title: string; date: string; time: string | null; where: string; details: string; durationMin: number }): string {
    const d = opts.date.replace(/-/g, '');
    const pad = (n: number) => String(n).padStart(2, '0');
    let dtStart: string, dtEnd: string;
    if (opts.time) {
        const [h, m] = opts.time.split(':').map(Number);
        dtStart = `DTSTART:${d}T${pad(h)}${pad(m)}00`;
        const end = h * 60 + m + (opts.durationMin || 60);
        dtEnd = `DTEND:${d}T${pad(Math.floor(end / 60) % 24)}${pad(end % 60)}00`;
    } else {
        const [y, mo, da] = opts.date.split('-').map(Number);
        const next = new Date(Date.UTC(y, mo - 1, da + 1));
        dtStart = `DTSTART;VALUE=DATE:${d}`;
        dtEnd = `DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
    }
    const esc = (s: string) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Galloway Getaways//Experiences//EN',
        'BEGIN:VEVENT', `UID:${d}-${Math.random().toString(36).slice(2)}@gallowaygetaways.co.uk`,
        dtStart, dtEnd, `SUMMARY:${esc(opts.title)}`, `LOCATION:${esc(opts.where)}`, `DESCRIPTION:${esc(opts.details)}`,
        'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
}

export default async function OrderPage({ params, searchParams }: { params: { orderId: string }; searchParams: { booked?: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/trips');

    const admin = adminClient();
    const { data: order } = await admin
        .from('service_orders')
        .select('id, guest_id, provider_id, listing_id, booking_id, status, shape, service_date, service_time, price, item_name, item_description, provider_business_name, allergy, note, attendees, duration_minutes, fulfilment, service_address')
        .eq('id', params.orderId)
        .maybeSingle();
    if (!order || order.guest_id !== user.id) redirect('/trips');

    const [{ data: prov }, { data: listing, error: listingError }] = await Promise.all([
        // contact_phone is deliberately NOT selected any more. It is null on
        // every experience provider by construction — the sign-up wizard only
        // shows the phone field to non-guest trades — so the Call button it fed
        // was dead on every order. Dropped rather than left to vanish silently.
        // stripe_mcc + trade feed isFoodProvider (the allergy gate); guest_details
        // carries the live experience content — itinerary, what-to-expect and the
        // host's credentials — the same JSONB the public listing reads.
        admin.from('service_providers').select('owner_id, business_name, provider_name, based_line, headshot, photos, description, cancellation_window_hours, slot_length_minutes, fulfilment, collection_street, collection_town, collection_postcode, stripe_mcc, trade, guest_details').eq('id', order.provider_id).maybeSingle(),
        order.listing_id
            // The cottage the experience is attached to. `address` is not a column
            // on listings — the address is street_address + postcode + location —
            // and selecting it returned a PostgREST error, nulling the whole row,
            // so the "Comes to your cottage" line silently lost both name and
            // address. Select the real columns and compose the address below.
            ? admin.from('listings').select('id, title, street_address, postcode, location').eq('id', order.listing_id).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
    ]);
    if (listingError) {
        await logError('experiences/order: could not load the cottage', listingError, {
            path: '/experiences/order/' + params.orderId,
            userId: user.id,
        });
    }

    // "12 Shore Road, DG7 1AB, Kirkcudbright" — the same order the trips page uses.
    // Prefer the address FROZEN on the order at booking (a travelling session's
    // picked stay); fall back to the live listing for orders taken before the
    // freeze existed. The guest is always allowed their own destination.
    const cottageAddress = (order.service_address as string | null) || (listing
        ? [listing.street_address, listing.postcode, listing.location].filter(Boolean).join(', ')
        : '');

    // The trading name is the professional title — it belongs in the eyebrow and
    // the h1, but it reads as nonsense dropped into a slot meant for a person
    // ("Message A Galloway table, cooked in your cottage"). So we also carry a
    // SHORT, personal name — the host's first name, the same one the public
    // listing shows under "Hosted by" — for the sentences that address them as a
    // person, and fall back to the neutral "the provider" when we don't have one.
    const who = order.provider_business_name || (prov && prov.business_name) || 'the provider';
    const { data: hostProfile } = prov && prov.owner_id
        ? await admin.from('profiles').select('full_name, preferred_name, show_full_name').eq('id', prov.owner_id).maybeSingle()
        : { data: null };
    const hostFirst = firstName(hostProfile, '');
    const shortWho = hostFirst || 'the provider';

    // The face and the photos. Both columns hold STORAGE KEYS, resolved to public
    // URLs the same way the listing and card do (getImageUrl). No key → no image;
    // we fall back to the host's initial for the avatar and omit the hero, rather
    // than showing an invented placeholder.
    const headshotUrl = prov && prov.headshot && String(prov.headshot).trim() ? getImageUrl(String(prov.headshot).trim()) : null;
    const gallery = Array.isArray(prov?.photos) ? (prov!.photos as string[]).filter(Boolean).map((k) => getImageUrl(k)) : [];
    const hero = gallery[0] || null;

    const windowHours = Number(prov && prov.cancellation_window_hours) || 48;
    const charged = order.status === 'confirmed';
    const free = charged
        ? guestMayCancelFree(order.shape, String(order.service_date), order.service_time || null, windowHours, new Date())
        : false;

    const meta = STATUS[order.status] || { label: order.status, tone: 'over' as const };
    const live = order.status === 'authorised' || order.status === 'confirmed' || order.status === 'holding';
    // The conversation lives in one place only — the guest inbox thread for this
    // order (/messages?o=…), the same route the provider and confirmation emails
    // point at. So the page carries a "Message the host" link, not a composer.
    // The inbox only holds a thread once the order is authorised or confirmed (a
    // holding order is still mid-checkout), so the link shows on those two.
    const canMessage = order.status === 'authorised' || order.status === 'confirmed';
    const { count: unreadFromProvider } = canMessage
        ? await admin.from('messages').select('id', { count: 'exact', head: true })
            .eq('order_id', order.id).eq('recipient_id', user.id).is('read_at', null)
        : { count: 0 };
    const unreadCount = Number(unreadFromProvider) || 0;

    // The fulfilment DIRECTION is read off the ORDER, not the provider's live
    // setup: 'collection' = the guest comes to the host's address, 'delivery' =
    // the host runs the session at the guest's cottage. It was frozen at booking
    // (the claim / the webhook), so a provider who later switches their setup
    // never rewrites what this guest booked. The ADDRESS below still comes live
    // from the provider — only the direction is the frozen deal.
    const isSlot = order.shape === 'slot';
    const { comesToCottage, collects } = orderLocation(order, prov?.fulfilment);
    // Assembled from the three private fields, same order the cottage address
    // uses: "The Old Bakery, 4 Shore Road, Kirkcudbright, DG6 4JT". Released only
    // once the order is confirmed (i.e. paid — `charged`).
    const collectionAddress = charged && collects
        ? ([prov?.collection_street, prov?.collection_town, prov?.collection_postcode]
            .map((p) => (p || '').trim()).filter(Boolean).join(', ') || null)
        : null;

    // WHICH OF THE THREE SHAPES IS THIS, AND DOES IT HAVE A VENUE?
    //
    // A venue is somewhere the GUEST has to travel to. That is true of a
    // come-to-me slot and of a collection, and false of a chef coming to the
    // cottage or a cake made for a date. Only a venue earns the map pane and the
    // copy-address / get-directions rows.
    const hasVenue = !comesToCottage && !!collectionAddress;

    // The coordinates for the map. The provider has no latitude/longitude of
    // their own — the only point we hold is the centre of a service AREA they
    // work in (service_areas), which is what the public experience listing maps
    // too. So this is a sense-of-place map, not a pin on the door, and it is
    // labelled as such. Geocoding the collection address would be needed to do
    // what Airbnb does, and that is not built.
    const { data: areaRow } = hasVenue
        ? await admin.from('service_areas').select('label, centre_lat, centre_lng').eq('provider_id', order.provider_id).not('centre_lat', 'is', null).limit(1).maybeSingle()
        : { data: null };
    const mapLat = areaRow && areaRow.centre_lat != null ? Number(areaRow.centre_lat) : null;
    const mapLng = areaRow && areaRow.centre_lng != null ? Number(areaRow.centre_lng) : null;
    // NEXT_PUBLIC_MAPBOX_TOKEN is unrestricted and the Mapbox account has no
    // payment card, so the map must not reach production traffic. PropertyMap
    // already degrades to an empty frame with no token; this gate goes further
    // and drops the pane entirely, so a tokenless environment renders the plain
    // full-width column rather than a grey box pretending to be a map.
    const showMap = hasVenue && mapLat != null && mapLng != null && !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    const where = comesToCottage
        ? (cottageAddress || 'Your cottage')
        : (collectionAddress || prov?.based_line || who);
    // Get directions goes to Google Maps, which is exactly what the reference's
    // row does — but theirs queries by COORDINATES and this one queries by the
    // ADDRESS, deliberately. Their coordinates are the meeting point; the only
    // coordinates we hold are the centre of a service AREA, so sending those to
    // a directions app would route the guest to the middle of the Stewartry
    // instead of the bakery. The written address is the exact one, so it is the
    // better query for us even though it is the weaker kind of query in general.
    const directionsHref = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(where);
    const badge = live ? untilBadge(String(order.service_date)) : null;
    // The session length as RECORDED — null when nothing records one. The
    // 60-minute fallback below is fine for an .ics, which must have an end, but
    // not for printing "Ends 08:30" on the page: that would be inventing a fact
    // about someone else's session, and a guest turning up expecting it to run
    // an hour is a real consequence. No recorded length → no Ends column.
    const knownDuration = Number(order.duration_minutes) || Number(prov?.slot_length_minutes) || null;
    const durationMin = knownDuration || 60;
    const bio = (prov?.description || '').trim();

    // The allergy PROMPT is food-trades-only, gated on the provider's Stripe MCC
    // (isFoodProvider) — the same gate the booking panels use to decide whether to
    // ask. The order page repeats the gate on the DISPLAY rather than trusting the
    // stored value: the value is written by the booking routes, which do not
    // re-check the gate, so a stray allergy on a non-food order must still never
    // surface on a sauna. The general note below is different and shows on every
    // shape.
    const isFood = isFoodProvider(prov);

    // The experience content, read LIVE from guest_details — the same source and
    // the same freshness as the host bio (prov.description) already has. Nothing
    // is frozen onto the order: a host improving their write-up improves every
    // guest's page, which is the behaviour the bio already sets.
    const gd = (prov?.guest_details || {}) as Record<string, unknown>;
    const whatToExpect = typeof gd.what_to_expect === 'string' ? gd.what_to_expect.trim() : '';
    const itinerary = Array.isArray(gd.itinerary)
        ? (gd.itinerary as unknown[])
            .map((s) => ({ title: String((s as any)?.title || '').trim(), detail: String((s as any)?.detail || '').trim() }))
            .filter((s) => s.detail)
        : [];
    // The experience blurb prefers the provider's live "what to expect"; a
    // provider who wrote none (a made-to-order baker, whose guest_details is bare)
    // falls back to the item line frozen on the order — what this page showed
    // before — so the section is never emptier than it was.
    const experienceBlurb = whatToExpect || (order.item_description || '').trim();
    const hasWhat = Boolean(experienceBlurb || itinerary.length);
    // The fuller host bio: a professional title (unless it just echoes the
    // business name), the free-text description, and the credentials the listing
    // shows under "About your host".
    const proTitle = typeof gd.professional_title === 'string' && gd.professional_title.trim()
        && gd.professional_title.trim().toLowerCase() !== who.trim().toLowerCase()
        ? gd.professional_title.trim() : null;
    const qualifications = typeof gd.qualifications === 'string' ? gd.qualifications.trim() : '';
    const recognition = typeof gd.recognition === 'string' ? gd.recognition.trim() : '';
    const years = yearsLabel(gd.years_experience != null ? String(gd.years_experience) : null);
    const hasAboutHost = Boolean(years || qualifications || recognition);

    return (
        // Hold the column to the viewport (less the sticky 80px nav + its border)
        // so a short order doesn't leave a long empty stretch above the footer —
        // the tint fills to the fold and the footer sits at the bottom.
        <div className="min-h-[calc(100dvh-81px)] bg-slate-50">
            <div className={`mx-auto px-4 sm:px-6 py-6 ${showMap ? 'max-w-[1180px]' : 'max-w-[640px]'}`}>
                <Link href="/trips" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
                    <ArrowLeft className="h-4 w-4" /> Your trips
                </Link>

                {/* Two panes at desktop, one column on a phone. Airbnb puts the
                    map ABOVE the content on a phone rather than dropping it, so
                    the order flips with flex ordering — one map instance, not
                    two, so Mapbox is never initialised twice on a page. */}
                <div className={showMap
                    ? 'mt-4 flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:gap-10 lg:items-start'
                    : 'mt-4'}>

                    {showMap && (
                        <aside className="order-1 lg:order-2 lg:sticky lg:top-24">
                            <PropertyMap
                                latitude={mapLat as number}
                                longitude={mapLng as number}
                                area={areaRow?.label ? `${areaRow.label} — the area, not the exact door` : 'The area, not the exact door'}
                                variant="card"
                                // The pin is the thing booked, the way the
                                // reference marks a booked experience: a small
                                // photo in a white bubble, not clickable.
                                pinImage={hero}
                                // A band on a phone, where it sits above the
                                // column, and a tall pane on desktop where it
                                // stands beside one.
                                frameClassName="h-[220px] lg:h-[620px]"
                            />
                        </aside>
                    )}

                    <div className={showMap ? 'order-2 lg:order-1 min-w-0' : ''}>

                        {/* Hero photo with the countdown badge, the way the
                            reference leads. No photo → no frame, rather than a
                            placeholder. */}
                        {hero && (
                            <div className="relative overflow-hidden rounded-2xl">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={hero} alt={order.item_name || 'Experience'} className="h-44 w-full object-cover sm:h-56" />
                                {badge && (
                                    <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-slate-900 shadow-sm">
                                        {badge}
                                    </span>
                                )}
                            </div>
                        )}

                        <div className={`${hero ? 'mt-4' : ''} flex items-start justify-between gap-3`}>
                            <h1 className="min-w-0 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{order.item_name || 'Experience'}</h1>
                            <span className={`inline-flex flex-none items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${PILL[meta.tone]}`}>
                                {meta.tone === 'ok' && <CheckCircle2 className="h-3 w-3" />}
                                {meta.tone === 'wait' && <Clock3 className="h-3 w-3" />}
                                {meta.tone === 'over' && <XCircle className="h-3 w-3" />}
                                {meta.label}
                            </span>
                        </div>

                        {/* The one-line summary under the title, as the reference
                            has it: time, how long, who. */}
                        <p className="mt-1.5 text-sm text-slate-500">
                            {[
                                isSlot && order.service_time ? clock(order.service_time) : null,
                                isSlot && knownDuration ? `${knownDuration} minutes` : null,
                                hostFirst ? `Hosted by ${hostFirst}` : null,
                            ].filter(Boolean).join(' · ')}
                        </p>

                        {/* Unread from the provider. Airbnb has an inbox badge in
                            its nav and needs no banner; we do not, so an unread
                            reply would otherwise be invisible on the one page the
                            guest opens. */}
                        {unreadCount > 0 && (
                            <Link href={'/messages?o=' + order.id} className="mt-4 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm font-medium text-emerald-900 hover:bg-emerald-100">
                                <MessageSquare className="h-4 w-4 flex-none" />
                                {unreadCount === 1 ? `${shortWho} has sent you a message` : `${unreadCount} new messages from ${shortWho}`}
                                <ChevronRight className="ml-auto h-4 w-4 flex-none" />
                            </Link>
                        )}

                        {/* Starts / Ends, the reference's bordered two-column box.
                            A made-to-order booking has no session, so it reads as
                            a single "Ready for" instead of an invented end time. */}
                        <div className="mt-5 rounded-2xl border border-slate-200 bg-white shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                            {isSlot && order.service_time && knownDuration ? (
                                <div className="grid grid-cols-2 divide-x divide-slate-200">
                                    <div className="p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Starts</div>
                                        <div className="mt-1 text-sm font-medium text-slate-900">{shortDay(order.service_date)}</div>
                                        <div className="text-sm text-slate-600">{clock(order.service_time)}</div>
                                    </div>
                                    <div className="p-4">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ends</div>
                                        <div className="mt-1 text-sm font-medium text-slate-900">{shortDay(order.service_date)}</div>
                                        <div className="text-sm text-slate-600">{endClock(order.service_time, durationMin)}</div>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4">
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        {order.shape === 'made_to_order' ? 'Ready for' : 'When'}
                                    </div>
                                    {/* A slot that reached this branch has a start
                                        time but no recorded length, so the start
                                        still shows — only the end is withheld. */}
                                    <div className="mt-1 text-sm font-medium text-slate-900">{longWhen(order.service_date, isSlot ? order.service_time : null)}</div>
                                </div>
                            )}
                        </div>

                        {/* The allergy the guest gave, shown back so they can see
                            it landed. It stays high on the page and stays loud —
                            the reference has no equivalent, because Airbnb is not
                            putting a stranger in your kitchen. Gated on isFood so a
                            value stored against a non-food order (the booking routes
                            do not re-check the gate) can never surface on a sauna. */}
                        {isFood && order.allergy && (
                            <div className="mt-4 rounded-xl border-2 border-rose-300 bg-rose-50 px-3.5 py-3">
                                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-rose-800">
                                    <AlertTriangle className="h-3.5 w-3.5" /> Your allergy note
                                </div>
                                <p className="mt-1 whitespace-pre-line text-sm text-rose-950">{order.allergy}</p>
                                <p className="mt-1.5 text-xs text-rose-700/80">
                                    {shortWho} has this — it led their booking email, and it is in your messages. If anything’s missing, add it there.
                                </p>
                            </div>
                        )}
                        {order.note && (
                            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">Your note</div>
                                <p className="mt-1 whitespace-pre-line text-sm text-amber-950">{order.note}</p>
                            </div>
                        )}

                        {/* ---- Where ---- */}
                        <section className="mt-8 border-t border-slate-200 pt-6">
                            <h2 className="text-lg font-semibold text-slate-900">
                                {/* A made-to-order cake with no fulfilment set
                                    has no meeting place at all, so it must not
                                    be headed "Where to meet" — the honest
                                    heading is the thing still to be agreed. */}
                                {comesToCottage ? 'Where they’re coming'
                                    : collects ? 'Where to collect'
                                        : isSlot ? 'Where to meet'
                                            : 'Collection or delivery'}
                            </h2>

                            <div className="mt-3 flex gap-3">
                                <MapPin className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
                                <div className="min-w-0 text-sm text-slate-800">
                                    {comesToCottage ? (
                                        <>
                                            <div>{shortWho} comes to you{listing && listing.title ? ` at ${listing.title}` : ''}</div>
                                            {cottageAddress && <div className="mt-0.5 text-slate-500">{cottageAddress}</div>}
                                        </>
                                    ) : collectionAddress ? (
                                        <>
                                            <div>{who}</div>
                                            <div className="mt-0.5 text-slate-500">{collectionAddress}</div>
                                        </>
                                    ) : prov && prov.based_line ? (
                                        <>
                                            <div>{who}</div>
                                            <div className="mt-0.5 text-slate-500">
                                                {prov.based_line}{charged ? '' : ' — the full address once your place is confirmed'}
                                            </div>
                                        </>
                                    ) : (
                                        <div>{shortWho} will arrange it with you — message them to sort it out.</div>
                                    )}
                                </div>
                            </div>

                            {/* Directions rows only where there is somewhere to
                                travel to. A chef coming to the cottage does not
                                need the guest directed to their own front door. */}
                            {hasVenue && collectionAddress && (
                                <div className="mt-3 divide-y divide-slate-200 border-t border-slate-200">
                                    <CopyAddressRow address={collectionAddress} className={ROW} />
                                    <a href={directionsHref} target="_blank" rel="noopener noreferrer" className={ROW}>
                                        <span className="flex items-center gap-3"><Navigation className="h-4 w-4 flex-none text-slate-400" /> Get directions</span>
                                        <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                                    </a>
                                </div>
                            )}
                        </section>

                        {/* ---- What you'll do ----
                            Airbnb's "What you'll do / How you'll spend your time".
                            The blurb plus the step-by-step itinerary, both live from
                            guest_details. Numbered steps rather than the listing's
                            per-phase icons — the narrow column reads better as a
                            plain sequence, and it is the same itinerary data, not a
                            second copy. Falls back to the frozen item line when a
                            provider wrote neither, so it is never emptier than the
                            old "About this experience". */}
                        {hasWhat && (
                            <section className="mt-8 border-t border-slate-200 pt-6">
                                {/* "What you'll do" for a session the guest attends;
                                    a made-to-order product (a cake) is not something
                                    they DO, so it keeps the neutral heading. */}
                                <h2 className="text-lg font-semibold text-slate-900">{order.shape === 'made_to_order' ? 'About this experience' : 'What you’ll do'}</h2>
                                {experienceBlurb && (
                                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{experienceBlurb}</p>
                                )}
                                {itinerary.length > 0 && (
                                    <ol className="mt-4 space-y-4">
                                        {itinerary.map((step, i) => (
                                            <li key={i} className="flex gap-3">
                                                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                                                    {i + 1}
                                                </span>
                                                <div className="min-w-0">
                                                    {step.title && <div className="text-sm font-semibold text-slate-900">{step.title}</div>}
                                                    <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-slate-700">{step.detail}</p>
                                                </div>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </section>
                        )}

                        {/* ---- Hosted by ---- */}
                        <section className="mt-8 border-t border-slate-200 pt-6">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h2 className="text-lg font-semibold text-slate-900">Hosted by {hostFirst || who}</h2>
                                    {/* The professional title, the eyebrow the
                                        listing carries — skipped when it only
                                        echoes the business name. */}
                                    {proTitle && <div className="mt-0.5 text-[13px] text-slate-500">{proTitle}</div>}
                                </div>
                                {headshotUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={headshotUrl} alt={hostFirst ? 'Hosted by ' + hostFirst : who} className="h-12 w-12 flex-none rounded-full object-cover ring-1 ring-slate-200" />
                                ) : (
                                    <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-slate-100 text-base font-semibold text-slate-500">
                                        {(hostFirst || who).slice(0, 1)}
                                    </span>
                                )}
                            </div>

                            {bio && (
                                // The reference's "Show more" is a LINK to a host
                                // profile page, not a disclosure toggle. We have no
                                // provider profile page, so this expands in place
                                // instead — <details> so it needs no JavaScript and
                                // the whole bio is present for search and print.
                                <details className="group mt-3">
                                    <summary className="cursor-pointer list-none text-sm leading-relaxed text-slate-700 [&::-webkit-details-marker]:hidden">
                                        <span className="line-clamp-3 group-open:line-clamp-none">{bio}</span>
                                        <span className="mt-1 inline-block font-semibold text-slate-900 underline group-open:hidden">Show more</span>
                                    </summary>
                                    <span className="mt-1 inline-block cursor-pointer text-sm font-semibold text-slate-900 underline">Show less</span>
                                </details>
                            )}

                            {/* The credentials the listing shows under "About your
                                host" — years, training, recognition — each only when
                                the host wrote it. A slot guide's safety training is
                                exactly what a guest wants before a cold-water swim. */}
                            {hasAboutHost && (
                                <dl className="mt-4 space-y-3">
                                    {years && (
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Experience</dt>
                                            <dd className="mt-0.5 text-sm text-slate-700">{years}</dd>
                                        </div>
                                    )}
                                    {qualifications && (
                                        <div>
                                            <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Award className="h-3.5 w-3.5 text-slate-400" /> Training &amp; qualifications</dt>
                                            <dd className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-slate-700">{qualifications}</dd>
                                        </div>
                                    )}
                                    {recognition && (
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recognition</dt>
                                            <dd className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-slate-700">{recognition}</dd>
                                        </div>
                                    )}
                                </dl>
                            )}

                            {canMessage && (
                                <Link
                                    href={'/messages?o=' + order.id}
                                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
                                >
                                    <MessageSquare className="h-4 w-4" /> Message {hostFirst || 'your host'}
                                </Link>
                            )}
                        </section>

                        {/* ---- Booking details (the admin block) ----
                            Moved BELOW the experience: the cancellation policy and
                            the calendar/print/cancel actions are the least-read part
                            of the page, so where-to-go and what-happens lead and the
                            admin follows, rather than the reverse. */}
                        <section className="mt-8 border-t border-slate-200 pt-6">
                            <h2 className="text-lg font-semibold text-slate-900">Booking details</h2>

                            {isSlot && Number(order.attendees) > 1 && (
                                <div className="mt-4">
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Party</div>
                                    <div className="mt-0.5 text-sm text-slate-800">{order.attendees} people — the whole session is yours</div>
                                </div>
                            )}

                            <div className="mt-4">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cancellation policy</div>
                                <p className="mt-0.5 text-sm leading-relaxed text-slate-700">{cancellationSentence(order.shape, windowHours, shortWho)}</p>
                            </div>

                            <div className="mt-3 divide-y divide-slate-200 border-t border-slate-200">
                                <a
                                    href={calendarHref({
                                        title: (order.item_name || 'Experience') + ' — ' + who,
                                        date: String(order.service_date).slice(0, 10),
                                        time: isSlot ? (order.service_time || null) : null,
                                        where,
                                        details: (order.item_description || '') + (order.note ? '\n\nYour note: ' + order.note : ''),
                                        durationMin,
                                    })}
                                    download={`${(order.item_name || 'experience').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`}
                                    className={ROW}
                                >
                                    <span className="flex items-center gap-3"><CalendarDays className="h-4 w-4 flex-none text-slate-400" /> Add to calendar</span>
                                    <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                                </a>
                                <PrintDetailsRow className={ROW} />
                                {live && (
                                    <OrderCancel
                                        orderId={order.id}
                                        status={order.status}
                                        charged={charged}
                                        free={free}
                                        price={Number(order.price)}
                                        providerName={shortWho}
                                        className={`${ROW} text-slate-600 hover:text-rose-700`}
                                        panelClassName="pb-3"
                                    />
                                )}
                            </div>
                        </section>

                        {/* ---- Payment ----
                            Airbnb's EXPERIENCE reservation shows no price, no
                            amount paid and no receipt — those live on its STAY
                            reservation under "Payment info". Deliberately NOT
                            copied: the provider is the merchant of record on this
                            order, not Galloway Getaways, so what the guest paid
                            and who they paid it to belongs on the page. Airbnb can
                            omit it because it is the merchant itself and its
                            receipts live in a trips-wide payments section this
                            product has no equivalent of. */}
                        <section className="mt-8 border-t border-slate-200 pt-6">
                            <h2 className="text-lg font-semibold text-slate-900">Payment</h2>
                            <div className="mt-3 flex items-baseline justify-between gap-3">
                                <span className="text-sm text-slate-500">{charged ? 'Paid' : 'Held, not charged'}</span>
                                <span className="text-xl font-semibold text-slate-900">£{Number(order.price).toFixed(2)}</span>
                            </div>
                            <p className="mt-1.5 text-sm text-slate-500">
                                {charged ? `Paid to ${who}. ` : `Held for ${who}, and only taken once they confirm. `}
                                Your receipt is emailed to you.
                            </p>
                        </section>

                        {/* ---- Support ---- */}
                        <section className="mt-8 border-t border-slate-200 pt-6 pb-2">
                            <h2 className="text-lg font-semibold text-slate-900">Need a hand?</h2>
                            <div className="mt-2 divide-y divide-slate-200 border-t border-slate-200">
                                {/* /experiences is not a route — there is no
                                    app/experiences/page.tsx. The marketplace
                                    index is /experiences/browse. */}
                                <Link href={'/experiences/browse'} className={ROW}>
                                    <span className="flex items-center gap-3"><BookOpen className="h-4 w-4 flex-none text-slate-400" /> Browse other experiences</span>
                                    <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                                </Link>
                                <Link href={'/contact'} className={ROW}>
                                    <span className="flex items-center gap-3"><LifeBuoy className="h-4 w-4 flex-none text-slate-400" /> Contact Galloway Getaways</span>
                                    <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                                </Link>
                            </div>
                        </section>

                        {/* The post-booking confirmation, only on the arrival from
                            Stripe (?booked=1). Everything it used to repeat now
                            lives in the sections above, so it is a short
                            acknowledgement rather than a second copy of the page. */}
                        {searchParams.booked && (order.status === 'confirmed' || order.status === 'holding') && (
                            <div className="mt-8 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-600" />
                                <p className="text-sm leading-relaxed text-emerald-900">
                                    {order.status === 'confirmed'
                                        ? <><span className="font-semibold">You’re booked.</span> Everything you need is on this page, and a receipt is on its way to your inbox.</>
                                        : <><span className="font-semibold">Payment received.</span> We’re just confirming your place with {shortWho} — this takes a moment, and your receipt will follow by email.</>}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
