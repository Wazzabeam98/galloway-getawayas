import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, MapPin, CheckCircle2, Clock3, XCircle, MessageSquare, Phone,
    CalendarDays, ChevronRight, KeyRound, ArrowRight, LifeBuoy, Star, CloudOff,
} from 'lucide-react';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { getImageUrl, capitializeFirst, displayName, firstName } from '@/lib/utils';
import { publicArea } from '@/lib/places';
import { partyLabel, confirmationNumber, cancellationWords } from '@/lib/bookingDisplay';
import { bookingReleasesPrivateData } from '@/lib/bookingEntitlement';
import { liveForGuestCard, stayCountdown, upcomingUntilCheckout } from '@/lib/bookingWindows';
import { directionsUrl as buildDirectionsUrl, appleDirectionsUrl } from '@/lib/directions';
import { loadBookingSeats } from '@/lib/groupSeats';
import { checkInMethodTitle, checkInBlurb } from '@/lib/checkInMethods';
import { londonDayKey } from '@/lib/dayKey';
import PropertyMap from '@/components/PropertyMap';
import DirectionsPicker from '@/components/arrival/DirectionsPicker';
import CopyField from '@/components/arrival/CopyField';
import TripGroup from '@/components/TripGroup';
import HouseRules from '@/components/HouseRules';
import WhenBadge from '@/components/WhenBadge';
import { PrintDetailsRow } from '@/components/marketplace/OrderUtilityRows';
import StayCancelRow from '@/components/trips/StayCancelRow';
import RequestChangeRow from '@/components/trips/RequestChangeRow';
import PayBalanceButton from '@/components/trips/PayBalanceButton';

export const dynamic = 'force-dynamic';

// A booked STAY, as a page — the holiday-let counterpart to the experience order
// page (app/experiences/order/[orderId]), built from the SAME layout and the
// same components rather than a second set: a narrow scrolling column beside a
// sticky map, a hero with the countdown badge, raised cards for the dates, and
// the reservation actions as quiet chevron rows.
//
// Three walls are kept exactly as the trips card and /api/trips hold them:
//   1. The door code and wifi password never reach this page. We read only
//      whether a code/wifi EXISTS (booleans) so the "Getting in" row can link to
//      the arrival screen, where the secrets live behind their own window.
//   2. A companion (someone added to the stay) never sees the money — the total,
//      the breakdown or any payment line. It is gated server-side here: those
//      sections don't render for a companion, so the bytes never leave the
//      server, and no money is passed to any client component.
//   3. The map shows the property's REAL coordinates or nothing — never a
//      town-centre pin standing in for a place we don't have.

const STATUS: Record<string, { label: string; tone: 'ok' | 'wait' | 'over' }> = {
    confirmed: { label: 'Confirmed', tone: 'ok' },
    pending: { label: 'Waiting to be confirmed', tone: 'wait' },
    cancelled: { label: 'Cancelled', tone: 'over' },
    declined: { label: 'Declined', tone: 'over' },
};
const PILL: Record<string, string> = {
    ok: 'bg-emerald-100 text-emerald-800',
    wait: 'bg-amber-100 text-amber-800',
    over: 'bg-slate-200 text-slate-600',
};

// One definition of a chevron action row — the same token the experience page
// shares with OrderUtilityRows, so the quiet-row pattern has a single style
// across both reservation pages.
const ROW = 'flex w-full items-center justify-between gap-3 py-3 text-left text-sm font-medium text-slate-800 hover:text-slate-950';

function weekday(dateStr: string): string {
    const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00');
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { weekday: 'long' });
}
function dateLong(dateStr: string): string {
    const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00');
    return isNaN(d.getTime()) ? String(dateStr) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
// "3:00pm" from a stored 'HH:MM[:SS]'. Null in, null out — no invented time.
function timeLabel(t: string | null | undefined): string | null {
    if (!t) return null;
    const [h, m] = String(t).split(':').map(Number);
    if (isNaN(h)) return null;
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = ((h + 11) % 12) + 1;
    return h12 + ':' + String(m || 0).padStart(2, '0') + ampm;
}

// A stamped night's date as "Fri 18 Sep", built at midday so the day never slips
// under a timezone offset.
function nightDateLabel(iso: string): string {
    const d = new Date(String(iso).split('T')[0] + 'T12:00:00');
    return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
// The word beside a night dearer than the base rate — a weekend or a seasonal
// override. Base nights say nothing; only the reason for a difference earns a word.
function nightKindLabel(kind: string): string {
    if (kind === 'weekend') return 'weekend';
    if (kind === 'override') return 'seasonal rate';
    return '';
}

// An all-day .ics for the whole stay. DTEND on an all-day VEVENT is exclusive,
// so the checkout date is the correct end — the last night is the night before.
// Returned as a data: URL so a plain <a download> saves it with no round trip.
function stayCalendarHref(opts: { title: string; checkIn: string; checkOut: string; where: string }): string {
    const d = (s: string) => String(s).slice(0, 10).replace(/-/g, '');
    const esc = (s: string) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Galloway Getaways//Stays//EN',
        'BEGIN:VEVENT', `UID:${d(opts.checkIn)}-${Math.random().toString(36).slice(2)}@gallowaygetaways.co.uk`,
        `DTSTART;VALUE=DATE:${d(opts.checkIn)}`, `DTEND;VALUE=DATE:${d(opts.checkOut)}`,
        `SUMMARY:${esc(opts.title)}`, `LOCATION:${esc(opts.where)}`,
        'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
}

export default async function StayReservationPage({ params }: { params: { bookingId: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/trips');

    const admin = adminClient();
    const { data: booking } = await admin.from('bookings').select('*').eq('id', params.bookingId).maybeSingle();
    if (!booking) redirect('/trips');

    // Role, and the money wall. The booker is the guest on the row; anyone else
    // is only allowed in if they hold an ACTIVE seat on the stay (a companion),
    // and a companion never sees the money. Everyone else is turned away.
    let role: 'booker' | 'companion' | null = booking.guest_id === user.id ? 'booker' : null;
    if (!role) {
        const { data: seat } = await admin.from('booking_guests')
            .select('id').eq('booking_id', booking.id).eq('user_id', user.id).eq('status', 'active').maybeSingle();
        if (seat) role = 'companion';
    }
    if (!role) redirect('/trips');
    const isBooker = role === 'booker';

    const { data: listing } = await admin.from('listings')
        .select('id, title, images, street_address, postcode, location, latitude, longitude, check_in_time, check_in_end_time, check_out_time, check_in_method, cancellation_policy, rating_avg, rating_count, events_allowed, smoking_allowed, commercial_photography_allowed, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, additional_rules, max_guests, amenities')
        .eq('id', booking.listing_id).maybeSingle();

    const { data: hostProfile } = booking.host_id
        ? await admin.from('profiles').select('id, full_name, preferred_name, show_full_name, phone, avatar_url, host_bio').eq('id', booking.host_id).maybeSingle()
        : { data: null };
    const hostName = capitializeFirst(hostProfile ? displayName(hostProfile, 'your host') : 'your host');
    const hostFirstName = firstName(hostProfile, '') || hostName.split(' ')[0];
    const hostAvatar = (hostProfile && hostProfile.avatar_url) ? getImageUrl(String(hostProfile.avatar_url)) : null;
    const hostBio = (hostProfile && (hostProfile.host_bio || '')).trim() || null;

    const now = new Date();
    const over = !liveForGuestCard(booking, now);
    const meta = STATUS[booking.status] || { label: booking.status, tone: 'over' as const };
    const live = (booking.status === 'confirmed' || booking.status === 'pending') && !over;
    const upcomingConfirmed = upcomingUntilCheckout(booking, now);
    const todayIso = londonDayKey(now);

    // ENTITLEMENT — private location data is released only for a confirmed, paid
    // stay (the shared bookingReleasesPrivateData rule). Everything the arrival
    // side treats as private — the exact address, coordinates, directions, the
    // host's phone, and whether there's a code/wifi to reveal — is read ONLY when
    // entitled, so a pending or over stay never even pulls it into memory. The
    // door code and wifi PASSWORD are never read here at all: hasCode/hasWifi are
    // existence booleans, exactly as /api/trips keeps them.
    const entitled = bookingReleasesPrivateData(booking);
    let addressLines: string[] = [];
    let addressString: string | null = null;
    let lat: number | null = null, lng: number | null = null;
    let googleDir: string | null = null, appleDir: string | null = null;
    let what3words: string | null = null, arrivalDirections: string | null = null;
    let hasCode = false, hasWifi = false;
    let hostPhone: string | null = null;
    if (entitled && listing) {
        const [{ data: arr }, { data: codes }] = await Promise.all([
            admin.from('listing_arrival').select('what3words, arrival_directions, parking_info, wifi_name').eq('listing_id', listing.id).maybeSingle(),
            admin.from('listing_access_codes').select('listing_id').eq('listing_id', listing.id).maybeSingle(),
        ]);
        addressLines = [listing.street_address, [listing.postcode, listing.location].filter(Boolean).join(', ')].filter(Boolean) as string[];
        addressString = [listing.street_address, listing.postcode, listing.location].filter(Boolean).join(', ') || null;
        lat = listing.latitude != null ? Number(listing.latitude) : null;
        lng = listing.longitude != null ? Number(listing.longitude) : null;
        const parts = { latitude: listing.latitude, longitude: listing.longitude, streetAddress: listing.street_address, postcode: listing.postcode, location: listing.location };
        googleDir = buildDirectionsUrl(parts);
        appleDir = appleDirectionsUrl(parts);
        what3words = (arr as any)?.what3words || null;
        arrivalDirections = (arr as any)?.arrival_directions || null;
        hasWifi = !!(arr as any)?.wifi_name;
        hasCode = !!codes;
        hostPhone = (hostProfile && hostProfile.phone) || null;
    }

    // The map: real coordinates or nothing, and never without a token (the public
    // Mapbox token is unrestricted, so the pane must not reach production traffic
    // — the same gate the experience page uses).
    const hasCoords = lat != null && lng != null && !(lat === 0 && lng === 0);
    const showMap = hasCoords && !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    // MONEY — booker only, never read for a companion. Read straight off the
    // booking row (already in memory); the wall is that none of it is rendered
    // or handed to a client component unless isBooker.
    const nights = Math.max(1, Math.round((new Date(String(booking.check_out).slice(0, 10)).getTime() - new Date(String(booking.check_in).slice(0, 10)).getTime()) / 86400000));
    const payTotal = Number(booking.total_price || 0);
    const payCleaning = Number(booking.cleaning_fee || 0);
    const payPet = Number(booking.pet_fee || 0);
    const payExtraGuest = Number(booking.extra_guest_fee || 0);
    const nightlySnapshot = Array.isArray(booking.nightly_breakdown) && booking.nightly_breakdown.length ? booking.nightly_breakdown : null;
    const payAccommodation = nightlySnapshot
        ? nightlySnapshot.reduce((s: number, n: any) => s + Number(n.rate || 0), 0)
        : Math.max(0, payTotal - payCleaning - payPet - payExtraGuest);
    const payOtherFees = Math.max(0, payTotal - payAccommodation - payCleaning - payPet - payExtraGuest);
    const payPaid = Number(booking.amount_paid || 0);
    const payRefunded = Number(booking.amount_refunded || 0);
    const payRemaining = Number(booking.balance_amount || 0);
    const balanceOverdue = !!booking.balance_due_date && String(booking.balance_due_date) < todayIso;
    const balanceDue = isBooker && booking.payment_status === 'deposit_paid' && payRemaining > 0
        && booking.status !== 'cancelled' && booking.status !== 'declined';

    // The guest's own confirmed experiences on this stay, so the cancel confirm
    // can name what the stay-cancel cascade takes with it (booker only).
    const { data: myOrders } = isBooker
        ? await admin.from('service_orders').select('item_name, service_date').eq('booking_id', booking.id).eq('guest_id', user.id).eq('status', 'confirmed')
        : { data: null };
    const cancelOrders = (myOrders || []).map((o: any) => ({ item_name: o.item_name, service_date: o.service_date }));

    // The party's seats, read server-side (the browser can't select booking_guests
    // — see lib/groupSeats) and handed to the invite block as its initial data.
    // Booker only, the only role that manages the group.
    const { seats: initialSeats, profiles: initialSeatProfiles } = isBooker
        ? await loadBookingSeats(admin, booking.id)
        : { seats: [], profiles: {} };

    // Review: a completed stay of your OWN, not yet reviewed, inside the window.
    const isCompleted = isBooker && booking.status === 'confirmed' && over;
    const { data: myReview } = isCompleted
        ? await admin.from('reviews').select('id').eq('reviewer_id', user.id).eq('booking_id', booking.id).eq('review_type', 'guest_to_host').maybeSingle()
        : { data: null };
    const reviewDaysLeft = (() => {
        if (!isCompleted || myReview) return null;
        const deadline = new Date(String(booking.check_out).slice(0, 10) + 'T00:00:00');
        deadline.setDate(deadline.getDate() + 14);
        return Math.ceil((deadline.getTime() - now.getTime()) / 86400000);
    })();

    const countdown = live ? stayCountdown(booking, now) : null;
    const phase = countdown?.phase ?? null;
    const withinWindow = !!countdown && countdown.daysUntilCheckIn <= 3;
    const phaseChip = phase === 'during' ? 'You’re here'
        : phase === 'today' ? 'You arrive today'
            : phase === 'tomorrow' ? 'You arrive tomorrow' : null;

    const heroKey = Array.isArray(listing?.images) ? (listing!.images as any[]).filter(Boolean)[0] : null;
    const hero = heroKey ? getImageUrl(heroKey) : null;
    const homeHref = '/homes/' + booking.listing_id;
    const cottageArea = listing?.location ? publicArea(listing.location) : null;
    const showRules = !!listing && upcomingConfirmed && (booking.payment_status === 'paid' || booking.payment_status === 'deposit_paid');

    return (
        <div className="min-h-[calc(100dvh-81px)] bg-slate-50">
            <div className={`mx-auto px-4 sm:px-6 py-6 ${showMap ? 'max-w-[1180px]' : 'max-w-[640px]'}`}>
                <Link href="/trips" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
                    <ArrowLeft className="h-4 w-4" /> Your trips
                </Link>

                <div className={showMap
                    ? 'mt-4 flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:gap-10 lg:items-start'
                    : 'mt-4'}>

                    {showMap && (
                        <aside className="order-1 lg:order-2 lg:sticky lg:top-24">
                            <PropertyMap
                                latitude={lat as number}
                                longitude={lng as number}
                                area={cottageArea || undefined}
                                variant="card"
                                pinImage={hero}
                                frameClassName="h-[220px] lg:h-[620px]"
                            />
                        </aside>
                    )}

                    <div className={showMap ? 'order-2 lg:order-1 min-w-0' : ''}>
                        {/* Hero with the countdown badge, top-left. No photo → no
                            frame rather than a placeholder. */}
                        {hero && (
                            <Link href={homeHref} className="group relative block overflow-hidden rounded-2xl">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={hero} alt={listing?.title || 'Your stay'} className="h-44 w-full object-cover transition group-hover:brightness-95 sm:h-56" />
                                {live && <WhenBadge date={String(booking.check_in)} />}
                            </Link>
                        )}

                        <div className={`${hero ? 'mt-4' : ''} flex items-start justify-between gap-3`}>
                            <h1 className="min-w-0 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                                <Link href={homeHref} className="hover:underline">{listing?.title || 'Your stay'}</Link>
                            </h1>
                            <span className={`inline-flex flex-none items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${PILL[meta.tone]}`}>
                                {meta.tone === 'ok' && <CheckCircle2 className="h-3 w-3" />}
                                {meta.tone === 'wait' && <Clock3 className="h-3 w-3" />}
                                {meta.tone === 'over' && <XCircle className="h-3 w-3" />}
                                {meta.label}
                            </span>
                        </div>

                        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
                            {/* No guest count here — it lives once, in Booking details. */}
                            <span>{[cottageArea, `${nights} ${nights === 1 ? 'night' : 'nights'}`].filter(Boolean).join(' · ')}</span>
                            {phaseChip && (
                                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">{phaseChip}</span>
                            )}
                        </p>

                        {/* The cottage's rating, so its score is here without a
                            click through — the same ≥3-reviews bar the listing uses. */}
                        {listing && Number(listing.rating_count) >= 3 && (
                            <Link href={`${homeHref}#reviews`} className="mt-1.5 inline-flex items-center gap-1 text-sm hover:underline">
                                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                <span className="font-medium text-slate-900">{Number(listing.rating_avg).toFixed(1)}</span>
                                <span className="text-slate-500">· {listing.rating_count} review{Number(listing.rating_count) === 1 ? '' : 's'}</span>
                            </Link>
                        )}

                        {/* Check-in / Check-out — two raised cards, day, date and
                            time. The lifted-card treatment the site reserves for
                            surfaces you act on. */}
                        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                            {([
                                { label: 'Check-in', date: booking.check_in, time: timeLabel(listing?.check_in_time), end: timeLabel(listing?.check_in_end_time) },
                                { label: 'Check-out', date: booking.check_out, time: timeLabel(listing?.check_out_time), end: null },
                            ] as const).map((c) => (
                                <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{c.label}</div>
                                    <div className="mt-1 text-sm font-medium text-slate-900">{weekday(c.date)}</div>
                                    <div className="text-sm text-slate-600">{dateLong(c.date)}</div>
                                    {c.time && (
                                        <div className="mt-1 text-sm text-slate-600">
                                            {c.label === 'Check-in' ? 'From ' : 'By '}{c.time}{c.end ? `–${c.end}` : ''}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* ---- Where you'll be ---- */}
                        <section className="mt-8 border-t border-slate-200 pt-6">
                            <h2 className="text-lg font-semibold text-slate-900">Where you’ll be</h2>
                            <div className="mt-3 flex gap-3">
                                <MapPin className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
                                <div className="min-w-0 text-sm text-slate-800">
                                    {addressLines.length ? (
                                        addressLines.map((line, i) => (
                                            <div key={i} className={i === 0 ? 'font-medium text-slate-900' : 'text-slate-500'}>{line}</div>
                                        ))
                                    ) : entitled ? (
                                        <div>Ask {hostFirstName} for the address in the messages.</div>
                                    ) : (
                                        <div className="text-slate-500">The full address appears here once your booking is confirmed.</div>
                                    )}
                                </div>
                            </div>
                            {(googleDir || appleDir || what3words || addressString) && (
                                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <DirectionsPicker apple={appleDir} google={googleDir} what3words={what3words} compact />
                                    {addressString && <CopyField value={addressString} label="Copy address" block />}
                                </div>
                            )}
                            {/* The host's own words for what sat-nav gets wrong. */}
                            {arrivalDirections && (
                                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">The last bit</div>
                                    <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-amber-950">{arrivalDirections}</p>
                                </div>
                            )}
                        </section>

                        {/* ---- Getting in ---- The ONE route to the door code and
                            wifi, which stay on the arrival screen behind a click.
                            Inside the three-day window the row links there; outside
                            it, a plain line or the check-in method. */}
                        {upcomingConfirmed && (
                            <section className="mt-8 border-t border-slate-200 pt-6">
                                <h2 className="text-lg font-semibold text-slate-900">Getting in</h2>
                                {withinWindow && (hasCode || hasWifi) ? (
                                    <Link href={`/arrival/${booking.id}`} className="group mt-3 flex items-center gap-3.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 transition hover:border-emerald-300 hover:bg-emerald-50">
                                        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-emerald-600 text-white"><KeyRound className="h-5 w-5" /></span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-semibold text-emerald-900">Your way in</span>
                                            <span className="block text-xs text-emerald-700">Door code and wifi on the arrival screen</span>
                                        </span>
                                        <ArrowRight className="h-5 w-5 flex-none text-emerald-600 transition group-hover:translate-x-0.5" />
                                    </Link>
                                ) : hasCode ? (
                                    <p className="mt-2 text-sm text-slate-500">Your way in appears here a few days before you arrive.</p>
                                ) : listing?.check_in_method ? (
                                    <div className="mt-2">
                                        <div className="text-sm font-medium text-slate-900">{checkInMethodTitle(listing.check_in_method)}</div>
                                        {checkInBlurb(listing.check_in_method) && <div className="text-sm text-slate-600">{checkInBlurb(listing.check_in_method)}</div>}
                                    </div>
                                ) : (
                                    <p className="mt-2 text-sm text-slate-500">{hostFirstName} will let you know how to get in — send a message if you’re not sure.</p>
                                )}
                            </section>
                        )}

                        {/* ---- Hosted by ---- with Call and Message. Sits between
                            where-you'll-be and who's-coming, matching the experience
                            page's section order. */}
                        <section className="mt-8 border-t border-slate-200 pt-6">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h2 className="text-lg font-semibold text-slate-900">Hosted by {hostFirstName || hostName}</h2>
                                    {cottageArea && <div className="mt-0.5 text-[13px] text-slate-500">{cottageArea}</div>}
                                </div>
                                {hostAvatar ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={hostAvatar} alt={hostName} className="h-12 w-12 flex-none rounded-full object-cover ring-1 ring-slate-200" />
                                ) : (
                                    <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-slate-100 text-base font-semibold text-slate-500">{(hostFirstName || hostName).slice(0, 1)}</span>
                                )}
                            </div>
                            {hostBio && (
                                <details className="group mt-3">
                                    <summary className="cursor-pointer list-none text-sm leading-relaxed text-slate-700 [&::-webkit-details-marker]:hidden">
                                        <span className="line-clamp-3 group-open:line-clamp-none">{hostBio}</span>
                                        <span className="mt-1 inline-block font-semibold text-slate-900 underline group-open:hidden">Show more</span>
                                    </summary>
                                    <span className="mt-1 inline-block cursor-pointer text-sm font-semibold text-slate-900 underline">Show less</span>
                                </details>
                            )}
                            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {entitled && hostPhone && (
                                    <a href={'tel:' + hostPhone} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
                                        <Phone className="h-4 w-4" /> Call
                                    </a>
                                )}
                                <Link href={'/messages/' + booking.id} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800">
                                    <MessageSquare className="h-4 w-4" /> Message {hostFirstName || 'your host'}
                                </Link>
                            </div>
                        </section>

                        {/* ---- Who's going ---- The invite, over the same machine
                            the cottage card uses. Booker-only (a companion can't
                            invite), matching the trips card. "Who's going" is the
                            one wording across stays and experiences alike. */}
                        {isBooker && booking.status !== 'cancelled' && booking.status !== 'declined' && (
                            <section className="mt-8 border-t border-slate-200 pt-6">
                                <h2 className="text-lg font-semibold text-slate-900">Who’s going</h2>
                                <div className="mt-3">
                                    <TripGroup
                                        bookingId={booking.id}
                                        guests={booking.guests}
                                        cottage={listing?.title}
                                        when={`${weekday(booking.check_in)} ${dateLong(booking.check_in)} – ${weekday(booking.check_out)} ${dateLong(booking.check_out)}`}
                                        initialSeats={initialSeats as any}
                                        initialProfiles={initialSeatProfiles as any}
                                    />
                                </div>
                            </section>
                        )}

                        {/* ---- Booking details ---- Confirmation, guests, total and
                            the breakdown. THE MONEY WALL: the whole block is the
                            booker's — a companion never renders it and no money
                            reaches their page. */}
                        {isBooker && (
                            <section className="mt-8 border-t border-slate-200 pt-6">
                                <h2 className="text-lg font-semibold text-slate-900">Booking details</h2>
                                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
                                    <div>
                                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Confirmation</div>
                                        <div className="mt-1 font-mono text-sm tracking-wide text-slate-900">{confirmationNumber(booking.id)}</div>
                                    </div>
                                    {partyLabel(booking) && (
                                        <div>
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Who’s going</div>
                                            <div className="mt-1 text-sm font-medium text-slate-900">{partyLabel(booking)}</div>
                                        </div>
                                    )}
                                </div>

                                {booking.status === 'cancelled' ? (
                                    <div className="mt-4">
                                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cancelled</div>
                                        <div className="mt-1 text-sm font-medium text-slate-900">
                                            {payRefunded > 0 ? `£${payRefunded.toFixed(2)} refunded` : payPaid > 0 ? 'No refund due' : 'Nothing was paid'}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-4">
                                        {/* Airbnb's structure: a bold label with the
                                            amount on its own line beneath, left-aligned.
                                            The full price and what's left sit in the
                                            breakdown / the balance box below. */}
                                        <div className="text-sm font-semibold text-slate-900">Amount paid</div>
                                        <div className="mt-1 text-base text-slate-900">£{payPaid.toFixed(2)}</div>
                                        {/* The breakdown opens in place — a <details>
                                            so it needs no client JavaScript, the same
                                            trick the experience page uses for the bio. */}
                                        <details className="group mt-2">
                                            <summary className="cursor-pointer list-none text-xs font-medium text-slate-500 underline hover:text-slate-800 [&::-webkit-details-marker]:hidden">
                                                <span className="group-open:hidden">Show breakdown</span>
                                                <span className="hidden group-open:inline">Hide breakdown</span>
                                            </summary>
                                            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                                                <div className="space-y-2 text-sm">
                                                    {/* Each night is its own line, at the rate FROZEN on the
                                                        booking at checkout — the per-night series lib/pricing.ts
                                                        computed and the checkout snapshotted (booking.nightly_breakdown).
                                                        A weekend or seasonal night is labelled, so a dearer night
                                                        reads as itself rather than being averaged away. Nothing is
                                                        re-priced here. A booking older than the snapshot falls back
                                                        to one estimated line. */}
                                                    {nightlySnapshot ? (
                                                        nightlySnapshot.map((n: any) => (
                                                            <div key={n.date} className="flex items-baseline justify-between text-slate-600">
                                                                <span>
                                                                    {nightDateLabel(n.date)}
                                                                    {nightKindLabel(n.kind) && <span className="ml-1.5 text-slate-400">· {nightKindLabel(n.kind)}</span>}
                                                                </span>
                                                                <span className="tabular-nums">£{Number(n.rate).toFixed(2)}</span>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <div className="flex items-baseline justify-between text-slate-600">
                                                            <span>
                                                                Accommodation · {nights} {nights === 1 ? 'night' : 'nights'}
                                                                <span className="block text-xs text-slate-400">Estimated — this booking predates the per-night record</span>
                                                            </span>
                                                            <span className="tabular-nums">£{payAccommodation.toFixed(2)}</span>
                                                        </div>
                                                    )}
                                                    {payExtraGuest > 0 && <div className="flex items-baseline justify-between text-slate-600"><span>Extra guest fee</span><span className="tabular-nums">£{payExtraGuest.toFixed(2)}</span></div>}
                                                    {payCleaning > 0 && <div className="flex items-baseline justify-between text-slate-600"><span>Cleaning fee</span><span className="tabular-nums">£{payCleaning.toFixed(2)}</span></div>}
                                                    {payPet > 0 && <div className="flex items-baseline justify-between text-slate-600"><span>Pet fee</span><span className="tabular-nums">£{payPet.toFixed(2)}</span></div>}
                                                    {payOtherFees > 0 && <div className="flex items-baseline justify-between text-slate-600"><span>Other fees</span><span className="tabular-nums">£{payOtherFees.toFixed(2)}</span></div>}
                                                    <div className="flex items-baseline justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900"><span>Total</span><span className="tabular-nums">£{payTotal.toFixed(2)}</span></div>
                                                    <div className="flex items-baseline justify-between text-slate-600"><span>Paid so far</span><span className="tabular-nums">£{payPaid.toFixed(2)}</span></div>
                                                    {payRefunded > 0 && <div className="flex items-baseline justify-between text-slate-600"><span>Refunded</span><span className="tabular-nums">£{payRefunded.toFixed(2)}</span></div>}
                                                    {payRemaining > 0 && (
                                                        <div className="flex items-baseline justify-between font-medium text-amber-800">
                                                            <span>Still to pay{booking.balance_due_date ? (balanceOverdue ? ' · overdue' : ' · due ' + booking.balance_due_date) : ''}</span>
                                                            <span className="tabular-nums">£{payRemaining.toFixed(2)}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </details>

                                        {balanceDue && (
                                            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                                                <div className="text-sm font-semibold text-amber-900">£{payRemaining.toFixed(2)} still to pay</div>
                                                <p className="mt-0.5 text-xs text-amber-800">
                                                    {booking.balance_due_date
                                                        ? (balanceOverdue
                                                            ? 'This was due on ' + booking.balance_due_date + ' and is taken from your card automatically — pay now to settle it.'
                                                            : 'This is taken from your card automatically on ' + booking.balance_due_date + '. You can pay it sooner if you prefer.')
                                                        : 'You can settle this at any time.'}
                                                </p>
                                                <PayBalanceButton bookingId={booking.id} />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </section>
                        )}

                        {/* ---- Cancellation policy ---- */}
                        {!over && booking.status !== 'cancelled' && booking.status !== 'declined' && (() => {
                            const words = cancellationWords(listing?.cancellation_policy);
                            return (
                                <section className="mt-8 border-t border-slate-200 pt-6">
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cancellation policy</div>
                                    <p className="mt-1 text-sm leading-relaxed text-slate-700">
                                        <span className="font-semibold text-slate-900">{words.tier}</span> — {words.summary}{' '}
                                        <Link href="/cancellation-policy" className="font-medium text-slate-600 underline hover:text-slate-800">Full terms</Link>
                                    </p>

                                    {/* The reservation actions: Request a change
                                        (guest proposes new dates/guests; the host
                                        approves), Cancel reservation, Add to
                                        calendar, Print details. */}
                                    <div className="mt-3 divide-y divide-slate-200 border-t border-slate-200">
                                        {isBooker && booking.status === 'confirmed' && String(booking.check_out).slice(0, 10) >= todayIso && (
                                            <RequestChangeRow
                                                bookingId={booking.id}
                                                listingId={booking.listing_id}
                                                listingTitle={listing?.title || 'your stay'}
                                                listingImage={hero}
                                                hostFirst={hostFirstName}
                                                checkIn={String(booking.check_in).slice(0, 10)}
                                                checkOut={String(booking.check_out).slice(0, 10)}
                                                adults={Number((booking as any).adults || 0) || Math.max(1, Number(booking.guests || 1) - Number((booking as any).children || 0))}
                                                childrenCount={Number((booking as any).children || 0)}
                                                pets={Number((booking as any).pets || 0)}
                                                maxGuests={Number(listing?.max_guests || 1)}
                                                petsAllowed={Array.isArray((listing as any)?.amenities) && (listing as any).amenities.indexOf('Pets allowed') !== -1}
                                                className={ROW}
                                            />
                                        )}
                                        {isBooker && String(booking.check_in).slice(0, 10) > todayIso && (
                                            <StayCancelRow
                                                bookingId={booking.id}
                                                checkIn={booking.check_in}
                                                policy={listing?.cancellation_policy}
                                                amountPaid={booking.amount_paid}
                                                amountRefunded={booking.amount_refunded}
                                                cleaningFee={(booking as any).cleaning_fee}
                                                orders={cancelOrders}
                                                className={`${ROW} text-slate-600 hover:text-rose-700`}
                                                panelClassName="pb-3"
                                            />
                                        )}
                                        <a
                                            href={stayCalendarHref({ title: listing?.title || 'Your stay', checkIn: booking.check_in, checkOut: booking.check_out, where: addressString || cottageArea || '' })}
                                            download={`${(listing?.title || 'stay').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`}
                                            className={ROW}
                                        >
                                            <span className="flex items-center gap-3"><CalendarDays className="h-4 w-4 flex-none text-slate-400" /> Add to calendar</span>
                                            <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                                        </a>
                                        <PrintDetailsRow className={ROW} />
                                    </div>
                                </section>
                            );
                        })()}

                        {/* ---- House rules ---- same source and wording as the
                            listing page, for a confirmed, paid, upcoming stay. */}
                        {showRules && (
                            <section className="mt-8 border-t border-slate-200 pt-6">
                                <HouseRules listing={listing} />
                            </section>
                        )}

                        {/* ---- Leave a review ---- a completed stay of your own. */}
                        {isCompleted && !myReview && reviewDaysLeft != null && reviewDaysLeft >= 0 && (
                            <section className="mt-8 border-t border-slate-200 pt-6">
                                <h2 className="text-lg font-semibold text-slate-900">How was it?</h2>
                                <div className="mt-3 flex items-center gap-3">
                                    <Link href={`/review/${booking.id}`} className="inline-flex items-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800">Leave a review</Link>
                                    <span className={`text-xs ${reviewDaysLeft <= 3 ? 'font-medium text-amber-700' : 'text-slate-400'}`}>{reviewDaysLeft === 0 ? 'Last day' : `${reviewDaysLeft} days left`}</span>
                                </div>
                            </section>
                        )}

                        {/* ---- Need a hand? ---- the out-of-hours backstop. */}
                        {upcomingConfirmed && (
                            <section className="mt-8 border-t border-slate-200 pt-6 pb-2">
                                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    <LifeBuoy className="h-3.5 w-3.5" /> If something’s not right
                                </div>
                                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                    If something isn’t right and {hostFirstName} can’t help, contact{' '}
                                    <a href="mailto:support@gallowaygetaways.co.uk" className="font-semibold text-emerald-700 hover:text-emerald-800">support@gallowaygetaways.co.uk</a>.
                                </p>
                                <p className="mt-4 flex items-center gap-1.5 text-[11px] text-slate-400">
                                    <CloudOff className="h-3.5 w-3.5" /> Signal’s patchy out here — open this before you set off and it stays put.
                                </p>
                            </section>
                        )}

                        {role === 'companion' && (
                            <p className="mt-6 text-xs text-slate-400">You were added to this trip. Whoever booked it looks after the payment and any changes.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
