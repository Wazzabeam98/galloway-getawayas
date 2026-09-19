import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, MapPin, CheckCircle2, Clock3, XCircle, AlertTriangle, Users, MessageSquare, Phone } from 'lucide-react';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { firstName, getImageUrl } from '@/lib/utils';
import { guestMayCancelFree } from '@/lib/serviceSlots';
import { orderLocation } from '@/lib/orderLocation';
import { cancellationSentence } from '@/components/marketplace/present';
import OrderCancel from '@/components/marketplace/OrderCancel';

export const dynamic = 'force-dynamic';

// A booked experience, as a page — not a line of text on the trip list. When,
// where, what to bring, the allergy the guest gave, the thread and the cancel.
// A wide two-column layout on desktop; a single column on a phone.

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

function longWhen(dateStr: string, timeStr: string | null): string {
    const d = new Date(dateStr + 'T00:00:00');
    const day = isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!timeStr) return day;
    const [h, m] = timeStr.split(':').map(Number);
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = ((h + 11) % 12) + 1;
    return day + ' at ' + h12 + (m ? ':' + String(m).padStart(2, '0') : '') + ampm;
}

// An .ics the guest can drop into their calendar. A slot has a real time, so it
// is a timed event; a made-to-order/comes-to-you booking is a date, so it is an
// all-day event. Floating local time (no Z) is what a guest expects — 2pm is 2pm
// wherever their phone is. Returned as a data: URL so a plain <a download> saves
// it with no round trip.
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
        admin.from('service_providers').select('owner_id, business_name, provider_name, based_line, headshot, photos, description, contact_phone, cancellation_window_hours, slot_length_minutes, fulfilment, collection_street, collection_town, collection_postcode').eq('id', order.provider_id).maybeSingle(),
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

    // The face and the photos. Airbnb's trip page leads with a photo and names
    // the host; this page had neither, on a page about a stranger cooking in the
    // guest's kitchen. Both columns hold STORAGE KEYS, resolved to public URLs
    // the same way the listing and card do (getImageUrl). No key → no image; we
    // fall back to the host's initial for the avatar and simply omit the hero,
    // rather than showing an invented placeholder.
    const headshotUrl = prov && prov.headshot && String(prov.headshot).trim() ? getImageUrl(String(prov.headshot).trim()) : null;
    const gallery = Array.isArray(prov?.photos) ? (prov!.photos as string[]).filter(Boolean).map((k) => getImageUrl(k)) : [];
    const hero = gallery[0] || null;

    const windowHours = Number(prov && prov.cancellation_window_hours) || 48;
    const charged = order.status === 'confirmed';
    const free = charged
        ? guestMayCancelFree(order.shape, String(order.service_date), order.service_time || null, windowHours, new Date())
        : false;

    // The review prompt used to live here; it now sits on the guest's trips
    // dashboard (components/ReviewPrompts) alongside everything else, rather
    // than being buried on this page.

    const meta = STATUS[order.status] || { label: order.status, tone: 'over' as const };
    const live = order.status === 'authorised' || order.status === 'confirmed' || order.status === 'holding';
    // The conversation lives in one place only — the guest inbox thread for this
    // order (/messages?o=…), the same route the provider and confirmation emails
    // point at. So the page carries a "Message the host" link, not a composer.
    // The inbox only holds a thread once the order is authorised or confirmed (a
    // holding order is still mid-checkout), so the link shows on those two.
    const canMessage = order.status === 'authorised' || order.status === 'confirmed';
    // Unread from the provider on this order, shown as a badge on that link so
    // the count is still visible here even though the thread itself has moved.
    const { count: unreadFromProvider } = canMessage
        ? await admin.from('messages').select('id', { count: 'exact', head: true })
            .eq('order_id', order.id).eq('recipient_id', user.id).is('read_at', null)
        : { count: 0 };
    const unreadCount = Number(unreadFromProvider) || 0;
    // The provider's business contact number, for the Call button. Only offered
    // once the guest is committed (authorised/confirmed), the same gate as the
    // message thread; the action row simply drops the button when there's none.
    const phone = (prov?.contact_phone || '').trim() ? String(prov!.contact_phone).replace(/\s+/g, '') : null;
    const showCall = canMessage && !!phone;
    // The fulfilment DIRECTION is read off the ORDER, not the provider's live
    // setup: 'collection' = the guest comes to the host's address, 'delivery' =
    // the host runs the session at the guest's cottage. It was frozen at booking
    // (the claim / the webhook), so a provider who later switches their setup
    // never rewrites what this guest booked. The ADDRESS below still comes live
    // from the provider — only the direction is the frozen deal. "Comes to your
    // cottage" is a comes-to-you shape OR a travelling slot; the address block
    // covers a collecting baker OR a come-to-me slot.
    // For a SLOT the direction is derived from the ORDER's frozen fulfilment, so
    // a later setup edit can't rewrite what the guest booked; a made-to-order
    // product still reads the provider's live value (its freeze is a follow-up),
    // passed in here. The collection ADDRESS, by contrast, is private and released
    // only once the order is confirmed (i.e. paid — `charged`), read live from the
    // provider below so a moved studio still directs the guest.
    const isSlot = order.shape === 'slot';
    const { comesToCottage, collects } = orderLocation(order, prov?.fulfilment);
    // Assembled from the three private fields, same order the cottage address
    // uses: "The Old Bakery, 4 Shore Road, Kirkcudbright, DG6 4JT".
    const collectionAddress = charged && collects
        ? ([prov?.collection_street, prov?.collection_town, prov?.collection_postcode]
            .map((p) => (p || '').trim()).filter(Boolean).join(', ') || null)
        : null;

    return (
        // Hold the column to the viewport (less the sticky 80px nav + its border)
        // so a short order doesn't leave a long empty stretch above the footer —
        // the tint fills to the fold and the footer sits at the bottom.
        <div className="min-h-[calc(100dvh-81px)] bg-slate-50">
            <div className="mx-auto max-w-[600px] px-4 sm:px-6 py-6">
                <Link href="/trips" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
                    <ArrowLeft className="h-4 w-4" /> Your trips
                </Link>

                {/* Header. The kicker line that used to name the business here is
                    gone — the title and the "Hosted by" row already carry it, and
                    Airbnb's reservation screen leads with the title alone. */}
                <div className="mt-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">{order.item_name || 'Experience'}</h1>
                    </div>
                    <span className={`inline-flex flex-none items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${PILL[meta.tone]}`}>
                        {meta.tone === 'ok' && <CheckCircle2 className="h-3 w-3" />}
                        {meta.tone === 'wait' && <Clock3 className="h-3 w-3" />}
                        {meta.tone === 'over' && <XCircle className="h-3 w-3" />}
                        {meta.label}
                    </span>
                </div>

                {/* The face: a headshot and the host's first name, so the page
                    isn't about an anonymous stranger. Same avatar treatment as the
                    public listing's "Hosted by" block; the initial stands in when
                    there's no photo. */}
                <div className="mt-3 flex items-center gap-2.5">
                    {headshotUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={headshotUrl} alt={hostFirst ? 'Hosted by ' + hostFirst : who} className="h-9 w-9 flex-none rounded-full object-cover ring-1 ring-slate-200" />
                    ) : (
                        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500">
                            {(hostFirst || who).slice(0, 1)}
                        </span>
                    )}
                    <span className="text-sm text-slate-600">{hostFirst ? 'Hosted by ' + hostFirst : 'Your host'}</span>
                </div>

                {/* The post-booking moment. A slot is paid and confirmed the
                    instant they land here (or 'holding' for the second the webhook
                    takes), so it says so plainly, tells them what happens next, and
                    hands them an add-to-calendar — instead of dropping them on a
                    banner and a list. Only on the arrival from Stripe (?booked=1). */}
                {searchParams.booked && (order.status === 'confirmed' || order.status === 'holding') && (
                    <div className="mt-5 overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50">
                        <div className="flex items-start gap-3 p-5">
                            <CheckCircle2 className="mt-0.5 h-6 w-6 flex-none text-emerald-600" />
                            <div className="min-w-0">
                                <h2 className="text-lg font-semibold text-emerald-900">
                                    {order.status === 'confirmed' ? 'You’re booked' : 'Payment received'}
                                </h2>
                                <p className="mt-1 text-sm leading-relaxed text-emerald-800">
                                    {order.status === 'confirmed'
                                        ? `You’ve paid £${Number(order.price).toFixed(2)} to ${who}. A receipt is on its way to your inbox.`
                                        : `We’re just confirming your place with ${shortWho} — this takes a moment and your receipt will follow by email.`}
                                </p>
                                <ol className="mt-3 space-y-1.5 text-sm text-emerald-800">
                                    <li className="flex gap-2"><span className="font-semibold">1.</span> Check your email for the receipt and the details.</li>
                                    <li className="flex gap-2"><span className="font-semibold">2.</span> {comesToCottage ? `${shortWho} will come to your cottage at the agreed time.` : isSlot ? (collectionAddress ? `Go to ${collectionAddress} at the time you booked.` : `Turn up at the time you booked — the address is below.`) : collectionAddress ? `Collect from ${collectionAddress}.` : `${shortWho} will be in touch about collection or delivery.`}</li>
                                    <li className="flex gap-2"><span className="font-semibold">3.</span> Anything to sort? Message {shortWho}.</li>
                                </ol>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <a
                                        href={calendarHref({
                                            title: (order.item_name || 'Experience') + ' — ' + who,
                                            date: String(order.service_date).slice(0, 10),
                                            time: order.service_time || null,
                                            where: comesToCottage ? (cottageAddress || 'Your cottage') : isSlot ? (collectionAddress || prov?.based_line || who) : (collectionAddress || cottageAddress || 'Your cottage'),
                                            details: (order.item_description || '') + (order.note ? '\n\nYour note: ' + order.note : ''),
                                            durationMin: Number(order.duration_minutes) || Number(prov?.slot_length_minutes) || 60,
                                        })}
                                        download={`${(order.item_name || 'experience').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-600/20 hover:bg-emerald-50"
                                    >
                                        <CalendarDays className="h-4 w-4" /> Add to calendar
                                    </a>
                                    <Link href={'/messages?o=' + order.id} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-emerald-800 hover:bg-white/60">
                                        Message {shortWho}
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* One lifted card, same family as the upcoming-trip and
                    upcoming-experience cards: an inset photo, the facts, then an
                    action row at the foot. The lifted token is reused, not varied. */}
                <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)] sm:p-5">
                    {/* Inset photo in its own rounded box (the experience-card
                        treatment), kept as a short band. Omitted when the provider
                        has no photos. */}
                    {hero && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={hero} alt={order.item_name || 'Experience'} className="h-24 w-full rounded-xl object-cover sm:h-28" />
                    )}

                    {/* When / where / party — the facts you scan. The description
                        the guest read before booking isn't reprinted (Airbnb's
                        reservation screen doesn't either). */}
                    <dl className={hero ? 'mt-4 space-y-4' : 'space-y-4'}>
                        <div className="flex gap-3">
                            <CalendarDays className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
                            <div>
                                {/* A date means different things by shape: an
                                    appointment for a chef, a deadline for a baker,
                                    a timed session for a slot. */}
                                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{order.shape === 'made_to_order' ? 'Ready for' : 'When'}</dt>
                                <dd className="text-sm text-slate-800">{longWhen(order.service_date, isSlot ? order.service_time : null)}</dd>
                            </div>
                        </div>
                        {/* Head count on a private session — the whole session is
                            theirs, so the provider knows how many to set up for. */}
                        {isSlot && Number(order.attendees) > 1 ? (
                            <div className="flex gap-3">
                                <Users className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
                                <div>
                                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Party</dt>
                                    <dd className="text-sm text-slate-800">{order.attendees} people — the whole session is yours.</dd>
                                </div>
                            </div>
                        ) : null}
                        <div className="flex gap-3">
                            <MapPin className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
                            <div>
                                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where</dt>
                                <dd className="text-sm text-slate-800">
                                    {comesToCottage ? (
                                        <>Comes to your cottage{listing && listing.title ? ' — ' + listing.title : ''}{cottageAddress ? <span className="block text-slate-500">{cottageAddress}</span> : null}</>
                                    ) : isSlot ? (
                                        // A come-to-me slot: the full address once paid (charged →
                                        // collectionAddress), the public town before then, and a
                                        // fallback only if the host set no address at all.
                                        <>You go to {who}{collectionAddress ? (
                                            <span className="block text-slate-500">{collectionAddress}</span>
                                        ) : prov && prov.based_line ? (
                                            <span className="block text-slate-500">{prov.based_line}{charged ? '' : ' — full address once your place is confirmed'}</span>
                                        ) : (
                                            <span className="block text-slate-500">Message them for the exact address and directions.</span>
                                        )}</>
                                    ) : collectionAddress ? (
                                        <>Collect from {who}<span className="block text-slate-500">{collectionAddress}</span></>
                                    ) : (
                                        <>{shortWho} will arrange collection or delivery with you — message them to sort it out.</>
                                    )}
                                </dd>
                            </div>
                        </div>
                    </dl>

                    {/* The allergy the guest gave, shown back so they can see it landed. */}
                    {order.allergy && (
                        <div className="mt-4 rounded-lg border-2 border-rose-300 bg-rose-50 px-3 py-2.5">
                            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-rose-800">
                                <AlertTriangle className="h-3.5 w-3.5" /> Your allergy note
                            </div>
                            <p className="mt-1 whitespace-pre-line text-sm text-rose-950">{order.allergy}</p>
                            <p className="mt-1 text-xs text-rose-700/80">{shortWho} has this. If anything’s missing, add it in your messages.</p>
                        </div>
                    )}
                    {order.note && (
                        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
                            <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">Your note</div>
                            <p className="mt-1 whitespace-pre-line text-sm text-amber-950">{order.note}</p>
                        </div>
                    )}

                    {/* Payment — the amount and the policy in words. The cancel
                        action itself lives in the action row below, not buried here. */}
                    <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
                        <span className="text-sm text-slate-500">{charged ? 'Paid' : 'Held, not charged'}</span>
                        <span className="text-lg font-semibold text-slate-900">£{Number(order.price).toFixed(2)}</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">{cancellationSentence(order.shape, windowHours, shortWho)}</p>

                    {/* Action row — call, message, cancel as icon buttons, the way
                        the trip card ends. Equal-width pills that wrap on a phone;
                        the cancel confirmation opens full-width below (basis-full). */}
                    {(showCall || canMessage || live) && (
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
                            {showCall && (
                                <a href={'tel:' + phone} className="inline-flex grow basis-0 min-w-[7rem] items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-900">
                                    <Phone className="h-4 w-4" /> Call
                                </a>
                            )}
                            {canMessage && (
                                <Link href={'/messages?o=' + order.id} className="inline-flex grow basis-0 min-w-[7rem] items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800">
                                    <MessageSquare className="h-4 w-4" /> Message
                                    {unreadCount > 0 && (
                                        <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-bold text-emerald-800">{unreadCount}</span>
                                    )}
                                </Link>
                            )}
                            {live && (
                                <OrderCancel
                                    orderId={order.id}
                                    status={order.status}
                                    charged={charged}
                                    free={free}
                                    price={Number(order.price)}
                                    providerName={shortWho}
                                    className="inline-flex grow basis-0 min-w-[7rem] items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-rose-300 hover:text-rose-700"
                                    panelClassName="mt-1 basis-full"
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
