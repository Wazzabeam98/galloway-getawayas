import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, MapPin, Info, CheckCircle2, Clock3, XCircle, AlertTriangle } from 'lucide-react';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { guestMayCancelFree } from '@/lib/serviceSlots';
import { cancellationSentence } from '@/components/marketplace/present';
import OrderThread from '@/components/marketplace/OrderThread';
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
        .select('id, guest_id, provider_id, listing_id, booking_id, status, shape, service_date, service_time, price, item_name, item_description, provider_business_name, allergy, note')
        .eq('id', params.orderId)
        .maybeSingle();
    if (!order || order.guest_id !== user.id) redirect('/trips');

    const [{ data: prov }, { data: listing, error: listingError }] = await Promise.all([
        admin.from('service_providers').select('business_name, provider_name, based_line, headshot, description, cancellation_window_hours, slot_length_minutes').eq('id', order.provider_id).maybeSingle(),
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
    const cottageAddress = listing
        ? [listing.street_address, listing.postcode, listing.location].filter(Boolean).join(', ')
        : '';

    const who = order.provider_business_name || (prov && prov.business_name) || 'the provider';
    const windowHours = Number(prov && prov.cancellation_window_hours) || 48;
    const charged = order.status === 'confirmed';
    const free = charged
        ? guestMayCancelFree(order.shape, String(order.service_date), order.service_time || null, windowHours, new Date())
        : false;

    const meta = STATUS[order.status] || { label: order.status, tone: 'over' as const };
    const live = order.status === 'authorised' || order.status === 'confirmed' || order.status === 'holding';
    const comesToCottage = order.shape === 'comes_to_you';
    const isSlot = order.shape === 'slot';

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
                <Link href="/trips" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
                    <ArrowLeft className="h-4 w-4" /> Your trips
                </Link>

                {/* Header, full width */}
                <div className="mt-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">{who}</p>
                        <h1 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">{order.item_name || 'Experience'}</h1>
                    </div>
                    <span className={`inline-flex flex-none items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${PILL[meta.tone]}`}>
                        {meta.tone === 'ok' && <CheckCircle2 className="h-3 w-3" />}
                        {meta.tone === 'wait' && <Clock3 className="h-3 w-3" />}
                        {meta.tone === 'over' && <XCircle className="h-3 w-3" />}
                        {meta.label}
                    </span>
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
                                        : `We’re just confirming your place with ${who} — this takes a moment and your receipt will follow by email.`}
                                </p>
                                <ol className="mt-3 space-y-1.5 text-sm text-emerald-800">
                                    <li className="flex gap-2"><span className="font-semibold">1.</span> Check your email for the receipt and the details.</li>
                                    <li className="flex gap-2"><span className="font-semibold">2.</span> {comesToCottage ? `${who} will come to your cottage at the agreed time.` : isSlot ? `Turn up at the time you booked — the address is below.` : `${who} will be in touch about collection or delivery.`}</li>
                                    <li className="flex gap-2"><span className="font-semibold">3.</span> Anything to sort? Message {who} below.</li>
                                </ol>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <a
                                        href={calendarHref({
                                            title: (order.item_name || 'Experience') + ' — ' + who,
                                            date: String(order.service_date).slice(0, 10),
                                            time: order.service_time || null,
                                            where: isSlot ? (prov?.based_line || who) : (cottageAddress || 'Your cottage'),
                                            details: (order.item_description || '') + (order.note ? '\n\nYour note: ' + order.note : ''),
                                            durationMin: Number(prov?.slot_length_minutes) || 60,
                                        })}
                                        download={`${(order.item_name || 'experience').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-600/20 hover:bg-emerald-50"
                                    >
                                        <CalendarDays className="h-4 w-4" /> Add to calendar
                                    </a>
                                    <a href="#order-messages" className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-emerald-800 hover:bg-white/60">
                                        Message {who}
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
                    {/* Main column — the detail, the allergy the guest gave, and the thread */}
                    <div className="space-y-5 lg:col-span-2">
                        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
                            <dl className="space-y-4">
                                <div className="flex gap-3">
                                    <CalendarDays className="mt-0.5 h-5 w-5 flex-none text-slate-400" />
                                    <div>
                                        {/* A date means different things by shape: an
                                            appointment for a chef, a deadline for a
                                            baker, a timed session for a slot. */}
                                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{order.shape === 'made_to_order' ? 'Ready for' : 'When'}</dt>
                                        <dd className="text-sm text-slate-800">{longWhen(order.service_date, isSlot ? order.service_time : null)}</dd>
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <MapPin className="mt-0.5 h-5 w-5 flex-none text-slate-400" />
                                    <div>
                                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where</dt>
                                        <dd className="text-sm text-slate-800">
                                            {comesToCottage ? (
                                                <>Comes to your cottage{listing && listing.title ? ' — ' + listing.title : ''}{cottageAddress ? <span className="block text-slate-500">{cottageAddress}</span> : null}</>
                                            ) : isSlot ? (
                                                <>You go to {who}{prov && prov.based_line ? <span className="block text-slate-500">{prov.based_line}</span> : <span className="block text-slate-500">Message them below for the exact address and directions.</span>}</>
                                            ) : (
                                                <>{who} will arrange collection or delivery with you — message them below.</>
                                            )}
                                        </dd>
                                    </div>
                                </div>
                                {(order.item_description || (prov && prov.description)) && (
                                    <div className="flex gap-3">
                                        <Info className="mt-0.5 h-5 w-5 flex-none text-slate-400" />
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Details</dt>
                                            <dd className="whitespace-pre-line text-sm text-slate-700">{order.item_description || (prov && prov.description)}</dd>
                                        </div>
                                    </div>
                                )}
                            </dl>

                            {/* The allergy the guest gave, shown back so they can see it landed. */}
                            {order.allergy && (
                                <div className="mt-4 rounded-lg border-2 border-rose-300 bg-rose-50 px-3 py-2.5">
                                    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-rose-800">
                                        <AlertTriangle className="h-3.5 w-3.5" /> Your allergy note
                                    </div>
                                    <p className="mt-1 whitespace-pre-line text-sm text-rose-950">{order.allergy}</p>
                                    <p className="mt-1 text-xs text-rose-700/80">{who} has this. If anything’s missing, add it in the messages below.</p>
                                </div>
                            )}
                            {order.note && (
                                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
                                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">Your note</div>
                                    <p className="mt-1 whitespace-pre-line text-sm text-amber-950">{order.note}</p>
                                </div>
                            )}
                        </div>

                        {/* Messages — the thread lives here, on the booking. */}
                        {live && (
                            <div id="order-messages" className="scroll-mt-6">
                                <h2 className="text-sm font-semibold text-slate-900">Messages with {who}</h2>
                                <p className="mt-0.5 text-xs text-slate-500">Agree the details — allergies, timing, what to bring, how to get there.</p>
                                <OrderThread orderId={order.id} />
                            </div>
                        )}
                    </div>

                    {/* Summary column — price, policy, cancel. Sticky on desktop. */}
                    <div className="lg:col-span-1">
                        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80 lg:sticky lg:top-6">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-slate-500">{charged ? 'Paid' : 'Held, not charged'}</span>
                                <span className="text-xl font-semibold text-slate-900">£{Number(order.price).toFixed(2)}</span>
                            </div>
                            <p className="mt-3 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-500">
                                {cancellationSentence(order.shape, windowHours, who)}
                            </p>
                            {live && (
                                <div className="mt-3">
                                    <OrderCancel
                                        orderId={order.id}
                                        status={order.status}
                                        charged={charged}
                                        free={free}
                                        price={Number(order.price)}
                                        providerName={who}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
