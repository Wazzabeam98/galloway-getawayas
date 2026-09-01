'use client';

import { useCallback, useEffect, useState } from 'react';
import { getImageUrl } from '@/lib/utils';

// What a guest sees on a stay they have already paid for: the local guest
// experiences near their cottage they can book for their dates.
//
// Deliberately quiet when there is nothing to show — no live provider covering
// the cottage means the section does not render at all, rather than an empty
// "no experiences" box on every trip.
//
// A guest experience is sold on the work itself, so the gallery is the listing,
// not a nice-to-have — and a guest is choosing someone to come into the cottage
// they are staying in, so the card carries a bit of who they are, not only what
// they charge. The provider's own words carry what the experience is
// ("three-course dinner for up to six, £180"); the price is theirs, unmarked-up.
// Who the guest is contracting with is said plainly, before they pay — the
// request sends them to Stripe to authorise their card, held not charged until
// the provider confirms.

interface Provider {
    id: string;
    business_name: string;
    // The person behind the business, and the words that say who they are.
    provider_name: string | null;
    based_line: string | null;
    about: string | null;
    what_to_expect: string | null;
    headshot: string | null;
    // The word above them — the trade's own, or the owner-assigned word for a
    // "something else" business. Never a raw trade key.
    category: string;
    description: string | null;
    photos: string[] | null;
    price: number;
}

// What the guest has already asked for on this stay — so a request is something
// they can see and pull out of, not an email they may never have received.
interface Order {
    id: string;
    status: string;
    service_date: string;
    price: number;
    provider_business_name: string | null;
}

const ORDER_WORD: Record<string, string> = {
    authorised: 'Awaiting their answer',
    confirmed: 'Confirmed',
    declined: 'They couldn’t make it',
    expired: 'No answer in time',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
};

// yyyy-mm-dd one day before check-out — the last night the guest is here.
function lastNight(checkOut: string): string {
    const d = new Date(checkOut + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

export default function GuestExperiences(props: {
    bookingId: string;
    checkIn: string;
    checkOut: string;
    town?: string | null;
}) {
    const { bookingId, checkIn, checkOut, town } = props;

    const [providers, setProviders] = useState<Provider[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [open, setOpen] = useState(true);
    const [dateFor, setDateFor] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(() => {
        return fetch('/api/services/experiences?booking=' + encodeURIComponent(bookingId))
            .then((r) => r.json())
            .then((d) => {
                setOpen(d && d.open !== false);
                setProviders((d && d.providers) || []);
                setOrders((d && d.orders) || []);
                setLoaded(true);
            })
            .catch(() => setLoaded(true));
    }, [bookingId]);

    useEffect(() => { load(); }, [load]);

    async function cancel(order: Order) {
        setBusy(order.id);
        setError(null);
        setNote(null);
        try {
            const res = await fetch('/api/services/orders/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: order.id }),
            });
            const d = await res.json();
            if (d && d.ok) {
                setNote(d.status === 'refunded' ? 'Cancelled and refunded in full.' : 'Request cancelled.');
                await load();
            } else {
                setError((d && d.error) || 'Could not cancel that.');
            }
        } catch {
            setError('Could not cancel that.');
        }
        setBusy(null);
    }

    async function request(provider: Provider) {
        const serviceDate = dateFor[provider.id];
        if (!serviceDate) { setError('Pick a date first.'); return; }
        setBusy(provider.id);
        setError(null);
        try {
            const res = await fetch('/api/services/order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId: provider.id, bookingId, serviceDate }),
            });
            const d = await res.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start that.');
        } catch {
            setError('Could not start that.');
        }
        setBusy(null);
    }

    if (!loaded) return null;

    // Closed until launch. The homepage promises this, so the trip page should
    // not be silent about it — a visible "coming soon", not a hidden nothing.
    // There is no button: the section says it is coming and cannot be used, and
    // the server refuses a request even if one were forged.
    if (!open) {
        return (
            <section className="mt-8 rounded-lg border border-dashed border-gray-300 p-5">
                <h3 className="text-lg font-semibold text-gray-900">Coming soon to your stay</h3>
                <p className="mt-1 text-sm text-gray-500">
                    Guest experiences you’ll be able to book for your dates — a private chef, a
                    welcome hamper, a cake, and more. We’re lining up local businesses now.
                </p>
            </section>
        );
    }

    // Open, but nothing covers this stay and nothing has been requested —
    // render nothing rather than an empty box. If they have a request in
    // flight, show it even when no provider currently covers them.
    if (providers.length === 0 && orders.length === 0) return null;

    const max = lastNight(checkOut);

    // A request is "in flight" while it is held or confirmed — those are the two
    // the guest can still act on.
    const canCancel = (s: string) => s === 'authorised' || s === 'confirmed';

    return (
        <section className="mt-8">
            <h3 className="text-lg font-semibold text-gray-900">
                Make more of your stay{town ? ' near ' + town : ''}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
                Local businesses you can book for your dates. Paid securely; the
                provider is who you’re booking, and your card is only held until
                they confirm.
            </p>

            {orders.length > 0 ? (
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="text-sm font-semibold text-gray-900">Your requests</div>
                    <ul className="mt-2 divide-y divide-gray-200">
                        {orders.map((o) => (
                            <li key={o.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-gray-900 break-words">
                                        {o.provider_business_name || 'Experience'}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {o.service_date} · £{o.price.toFixed(2)} · {ORDER_WORD[o.status] || o.status}
                                    </div>
                                </div>
                                {canCancel(o.status) ? (
                                    <button
                                        type="button"
                                        disabled={busy === o.id}
                                        onClick={() => cancel(o)}
                                        className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:opacity-60"
                                    >
                                        {busy === o.id ? 'Cancelling…' : o.status === 'confirmed' ? 'Cancel' : 'Cancel request'}
                                    </button>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-1 text-[11px] leading-snug text-gray-400">
                        Cancel a held request any time. A confirmed booking is refunded in full up to 48 hours before the date.
                    </p>
                    {note ? <p className="mt-2 text-xs text-emerald-700">{note}</p> : null}
                </div>
            ) : null}

            {providers.length === 0 ? null : (

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {providers.map((p) => {
                    const photos = (p.photos || []).filter(Boolean);
                    // The name the guest is told they are dealing with: the person
                    // where they gave one, the business otherwise.
                    const who = (p.provider_name && p.provider_name.trim()) || p.business_name;
                    return (
                    <div key={p.id} className="overflow-hidden rounded-lg border border-gray-200">
                        {/* The gallery is the listing. Their own photos of the
                            work, first thing, because a guest picks an experience
                            from what it looks like — unlike a plumber, whom nobody
                            chooses from a photo. */}
                        {photos.length > 0 ? (
                            // One, two or three across — matched to how many there
                            // are, so two photos fill the width rather than leaving
                            // a third empty column.
                            <div className={`grid gap-0.5 ${photos.length === 1 ? 'grid-cols-1' : photos.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                                {photos.slice(0, 3).map((path) => (
                                    <img
                                        key={path}
                                        src={getImageUrl(path)}
                                        alt={`${who} — ${p.category}`}
                                        loading="lazy"
                                        className="h-32 w-full object-cover"
                                    />
                                ))}
                            </div>
                        ) : null}

                        <div className="p-4">
                            <div className="text-xs uppercase tracking-wide text-emerald-700">
                                {p.category}
                            </div>

                            {/* Who they are, not only what they charge. */}
                            <div className="mt-1 flex items-center gap-3">
                                {p.headshot ? (
                                    <img
                                        src={getImageUrl(p.headshot)}
                                        alt={who}
                                        className="h-10 w-10 shrink-0 rounded-full object-cover"
                                    />
                                ) : null}
                                <div className="min-w-0">
                                    <div className="font-semibold text-gray-900 break-words">{p.business_name}</div>
                                    {p.provider_name && p.provider_name.trim() && p.provider_name !== p.business_name ? (
                                        <div className="text-sm text-gray-600 break-words">{p.provider_name}</div>
                                    ) : null}
                                    {p.based_line ? (
                                        <div className="text-xs text-gray-500 break-words">{p.based_line}</div>
                                    ) : null}
                                </div>
                            </div>

                            {p.description ? (
                                <p className="mt-2 whitespace-pre-line text-sm text-gray-600">{p.description}</p>
                            ) : null}
                            {p.about ? (
                                <p className="mt-2 whitespace-pre-line text-sm text-gray-500">{p.about}</p>
                            ) : null}

                            <div className="mt-2 font-semibold text-gray-900">£{p.price.toFixed(2)}</div>

                            {p.what_to_expect ? (
                                <details className="mt-2 text-sm text-gray-600">
                                    <summary className="cursor-pointer text-emerald-700">What to expect</summary>
                                    <p className="mt-1 whitespace-pre-line">{p.what_to_expect}</p>
                                </details>
                            ) : null}

                            <label className="mt-3 block text-xs text-gray-500">
                                Date during your stay
                                <input
                                    type="date"
                                    min={checkIn}
                                    max={max}
                                    value={dateFor[p.id] || ''}
                                    onChange={(e) => setDateFor((s) => ({ ...s, [p.id]: e.target.value }))}
                                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                                />
                            </label>

                            <button
                                type="button"
                                disabled={busy === p.id}
                                onClick={() => request(p)}
                                className="mt-3 w-full rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                            >
                                {busy === p.id ? 'Starting…' : 'Request & hold my card'}
                            </button>

                            <p className="mt-2 text-[11px] leading-snug text-gray-400">
                                You’re booking {p.business_name}. Galloway Getaways takes the
                                payment on their behalf and is not the provider.
                            </p>
                        </div>
                    </div>
                    );
                })}
            </div>
            )}

            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </section>
    );
}
