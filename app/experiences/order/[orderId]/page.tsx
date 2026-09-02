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
    over: 'bg-stone-200 text-stone-600',
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

export default async function OrderPage({ params }: { params: { orderId: string } }) {
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
        admin.from('service_providers').select('business_name, provider_name, based_line, headshot, description, cancellation_window_hours').eq('id', order.provider_id).maybeSingle(),
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
        <div className="min-h-screen bg-stone-50">
            <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
                <Link href="/trips" className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-800">
                    <ArrowLeft className="h-4 w-4" /> Your trips
                </Link>

                {/* Header, full width */}
                <div className="mt-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">{who}</p>
                        <h1 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">{order.item_name || 'Experience'}</h1>
                    </div>
                    <span className={`inline-flex flex-none items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${PILL[meta.tone]}`}>
                        {meta.tone === 'ok' && <CheckCircle2 className="h-3 w-3" />}
                        {meta.tone === 'wait' && <Clock3 className="h-3 w-3" />}
                        {meta.tone === 'over' && <XCircle className="h-3 w-3" />}
                        {meta.label}
                    </span>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
                    {/* Main column — the detail, the allergy the guest gave, and the thread */}
                    <div className="space-y-5 lg:col-span-2">
                        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200/80">
                            <dl className="space-y-4">
                                <div className="flex gap-3">
                                    <CalendarDays className="mt-0.5 h-5 w-5 flex-none text-stone-400" />
                                    <div>
                                        <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">When</dt>
                                        <dd className="text-sm text-stone-800">{longWhen(order.service_date, order.service_time)}</dd>
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <MapPin className="mt-0.5 h-5 w-5 flex-none text-stone-400" />
                                    <div>
                                        <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">Where</dt>
                                        <dd className="text-sm text-stone-800">
                                            {comesToCottage ? (
                                                <>Comes to your cottage{listing && listing.title ? ' — ' + listing.title : ''}{cottageAddress ? <span className="block text-stone-500">{cottageAddress}</span> : null}</>
                                            ) : isSlot ? (
                                                <>You go to {who}{prov && prov.based_line ? <span className="block text-stone-500">{prov.based_line}</span> : <span className="block text-stone-500">Message them below for the exact address and directions.</span>}</>
                                            ) : (
                                                <>{who} will arrange collection or delivery with you — message them below.</>
                                            )}
                                        </dd>
                                    </div>
                                </div>
                                {(order.item_description || (prov && prov.description)) && (
                                    <div className="flex gap-3">
                                        <Info className="mt-0.5 h-5 w-5 flex-none text-stone-400" />
                                        <div>
                                            <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">Details</dt>
                                            <dd className="whitespace-pre-line text-sm text-stone-700">{order.item_description || (prov && prov.description)}</dd>
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
                                <h2 className="text-sm font-semibold text-stone-900">Messages with {who}</h2>
                                <p className="mt-0.5 text-xs text-stone-500">Agree the details — allergies, timing, what to bring, how to get there.</p>
                                <OrderThread orderId={order.id} />
                            </div>
                        )}
                    </div>

                    {/* Summary column — price, policy, cancel. Sticky on desktop. */}
                    <div className="lg:col-span-1">
                        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200/80 lg:sticky lg:top-6">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-stone-500">{charged ? 'Paid' : 'Held, not charged'}</span>
                                <span className="text-xl font-semibold text-stone-900">£{Number(order.price).toFixed(2)}</span>
                            </div>
                            <p className="mt-3 border-t border-stone-200 pt-3 text-xs leading-relaxed text-stone-500">
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
