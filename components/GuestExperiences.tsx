'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

// The trip page's window into the marketplace: a way IN, and the guest's own
// bookings shown back. The browsing and the booking themselves live on their own
// pages now (/experiences/[bookingId]) — this stays a summary, not a shop, so a
// trip card doesn't try to be a marketplace.

interface Order {
    id: string;
    status: string;
    service_date: string;
    price: number;
    item_name: string | null;
    provider_business_name: string | null;
}

const ORDER_WORD: Record<string, string> = {
    holding: 'Holding your place…',
    authorised: 'Awaiting their answer',
    confirmed: 'Confirmed',
    declined: 'They couldn’t make it',
    expired: 'No answer in time',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
};

export default function GuestExperiences(props: {
    bookingId: string;
    checkIn: string;
    checkOut: string;
    town?: string | null;
}) {
    const { bookingId, town } = props;

    const [providerCount, setProviderCount] = useState(0);
    const [orders, setOrders] = useState<Order[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [open, setOpen] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(() => {
        return fetch('/api/services/experiences?booking=' + encodeURIComponent(bookingId))
            .then((r) => r.json())
            .then((d) => {
                setOpen(d && d.open !== false);
                setProviderCount(((d && d.providers) || []).length);
                setOrders((d && d.orders) || []);
                setLoaded(true);
            })
            .catch(() => setLoaded(true));
    }, [bookingId]);

    useEffect(() => { load(); }, [load]);

    async function cancel(order: Order) {
        setBusy(order.id); setError(null); setNote(null);
        try {
            const res = await fetch('/api/services/orders/cancel', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id }),
            });
            const d = await res.json();
            if (d && d.ok) {
                setNote(d.status === 'refunded' ? 'Cancelled and refunded in full.' : 'Cancelled.');
                await load();
            } else setError((d && d.error) || 'Could not cancel that.');
        } catch { setError('Could not cancel that.'); }
        setBusy(null);
    }

    if (!loaded) return null;

    if (!open) {
        return (
            <section className="mt-8 rounded-lg border border-dashed border-gray-300 p-5">
                <h3 className="text-lg font-semibold text-gray-900">Coming soon to your stay</h3>
                <p className="mt-1 text-sm text-gray-500">
                    Experiences you’ll be able to book for your dates — a chef, a cake, a sauna, a
                    guided walk. We’re lining up local businesses now.
                </p>
            </section>
        );
    }

    if (providerCount === 0 && orders.length === 0) return null;

    const canCancel = (s: string) => s === 'authorised' || s === 'confirmed' || s === 'holding';

    return (
        <section className="mt-8">
            {providerCount > 0 && (
                <Link
                    href={`/experiences/${bookingId}`}
                    className="group flex items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 transition hover:border-emerald-300 hover:bg-emerald-50"
                >
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">Make more of your stay{town ? ' near ' + town : ''}</h3>
                        <p className="mt-1 text-sm text-gray-600">
                            Chefs, bakers, saunas and guides you can book for your dates.
                        </p>
                    </div>
                    <span className="whitespace-nowrap text-sm font-semibold text-emerald-700 group-hover:translate-x-0.5 transition">Browse →</span>
                </Link>
            )}

            {orders.length > 0 && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="text-sm font-semibold text-gray-900">Your experiences</div>
                    <ul className="mt-2 divide-y divide-gray-200">
                        {orders.map((o) => (
                            <li key={o.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-gray-900 break-words">
                                        {o.item_name || 'Experience'}{o.provider_business_name ? ' · ' + o.provider_business_name : ''}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {o.service_date} · £{o.price.toFixed(2)} · {ORDER_WORD[o.status] || o.status}
                                    </div>
                                </div>
                                {canCancel(o.status) && (
                                    <button type="button" disabled={busy === o.id} onClick={() => cancel(o)}
                                        className="text-xs font-medium text-gray-500 underline hover:text-gray-800 disabled:opacity-60">
                                        {busy === o.id ? '…' : 'Cancel'}
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-[11px] leading-snug text-gray-400">
                        Cancel a held request any time. A confirmed booking is refunded in full up to the
                        provider’s cancellation window.
                    </p>
                    {note ? <p className="mt-1 text-xs text-emerald-700">{note}</p> : null}
                    {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
                </div>
            )}
        </section>
    );
}
