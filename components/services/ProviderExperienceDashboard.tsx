'use client';

import { useCallback, useEffect, useState } from 'react';

// What an approved guest-trade provider does after approval: set up payouts,
// and answer the requests that come in.
//
// Two gates, and this screen is where the second one is crossed. Approval is
// already done — that is why this renders. Until payouts are set up, the
// provider is not live to guests and this says so plainly, with the one button
// that fixes it. Once live, it becomes the list of requests to confirm or
// decline, each with a held card and a 48-hour window.

interface Order {
    id: string;
    status: string;
    service_date: string;
    guests: number | null;
    price: number;
    guest_name: string | null;
    // Released only once the provider confirms — the route sends null until then.
    guest_phone: string | null;
    guest_email: string | null;
    // The cottage, released on confirm with the contact. address is the exact
    // address; a provider has to get there.
    listing: { id: string; title: string; address: string | null; image: string | null } | null;
    note: string | null;
    expires_at: string | null;
}

const STATUS_WORD: Record<string, string> = {
    authorised: 'Awaiting your answer',
    confirmed: 'Confirmed',
    declined: 'Declined',
    expired: 'Expired',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
};

export default function ProviderExperienceDashboard(props: { providerId: string }) {
    const { providerId } = props;

    const [payouts, setPayouts] = useState<null | { connected: boolean; payouts_enabled: boolean }>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadPayouts = useCallback(async () => {
        try {
            const r = await fetch('/api/services/connect?provider=' + encodeURIComponent(providerId));
            const d = await r.json();
            setPayouts({
                connected: !!(d && d.connected),
                payouts_enabled: !!(d && d.payouts_enabled),
            });
        } catch { /* leave null; the button still works */ }
    }, [providerId]);

    const loadOrders = useCallback(async () => {
        try {
            const r = await fetch('/api/services/orders?provider=' + encodeURIComponent(providerId));
            const d = await r.json();
            setOrders((d && d.orders) || []);
        } catch { /* ignore */ }
    }, [providerId]);

    useEffect(() => { loadPayouts(); loadOrders(); }, [loadPayouts, loadOrders]);

    async function setUpPayouts() {
        setBusy('payouts');
        setError(null);
        try {
            const r = await fetch('/api/services/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId }),
            });
            const d = await r.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start payout setup.');
        } catch {
            setError('Could not start payout setup.');
        }
        setBusy(null);
    }

    async function answer(orderId: string, decision: 'confirm' | 'decline' | 'refund') {
        // A refund gives the guest their money back — worth a beat before it
        // happens by accident.
        if (decision === 'refund' && typeof window !== 'undefined'
            && !window.confirm('Refund this booking in full? The guest gets their money back and this can’t be undone.')) {
            return;
        }
        setBusy(orderId);
        setError(null);
        try {
            const r = await fetch('/api/services/orders/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId, decision }),
            });
            const d = await r.json();
            if (!d || !d.ok) { setError((d && d.error) || 'Could not do that.'); }
            await loadOrders();
        } catch {
            setError('Could not do that.');
        }
        setBusy(null);
    }

    const live = payouts && payouts.payouts_enabled;
    const waiting = orders.filter((o) => o.status === 'authorised');
    const confirmed = orders.filter((o) => o.status === 'confirmed');
    const other = orders.filter((o) => o.status !== 'authorised' && o.status !== 'confirmed');

    return (
        <div className="mt-5 space-y-5">
            {/* Payouts — the second gate */}
            {!live && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                    <p className="font-semibold text-amber-900">One step before guests can book you</p>
                    <p className="mt-1 text-sm text-amber-900/80">
                        Set up payouts so we can pay you. You won’t appear to guests until this is done.
                    </p>
                    <button
                        type="button"
                        disabled={busy === 'payouts'}
                        onClick={setUpPayouts}
                        className="mt-3 rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                        {busy === 'payouts' ? 'Starting…' : (payouts && payouts.connected ? 'Finish setting up payouts' : 'Set up payouts')}
                    </button>
                </div>
            )}

            {live && (
                <p className="text-sm text-emerald-800">Payouts are set up — you’re live to guests.</p>
            )}

            {/* Orders to answer */}
            {waiting.length > 0 && (
                <div>
                    <p className="font-semibold text-gray-900">Requests to answer</p>
                    <div className="mt-3 space-y-3">
                        {waiting.map((o) => (
                            <div key={o.id} className="rounded-xl border border-gray-200 p-4">
                                <div className="text-sm text-gray-900">
                                    {o.service_date}
                                    {o.guests ? ' · ' + o.guests + ' guest' + (o.guests === 1 ? '' : 's') : ''}
                                    {' · £' + o.price.toFixed(2)}
                                </div>
                                {o.guest_name ? <div className="text-sm text-gray-500">For {o.guest_name}</div> : null}
                                {o.note ? <p className="mt-1 text-sm text-gray-600 whitespace-pre-line">{o.note}</p> : null}
                                <p className="mt-1 text-xs text-gray-400">
                                    Their card is held, not charged. Confirming takes the payment.
                                </p>
                                <div className="mt-3 flex gap-2">
                                    <button
                                        type="button"
                                        disabled={busy === o.id}
                                        onClick={() => answer(o.id, 'confirm')}
                                        className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                                    >
                                        {busy === o.id ? '…' : 'Confirm'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busy === o.id}
                                        onClick={() => answer(o.id, 'decline')}
                                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:opacity-60"
                                    >
                                        Decline
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Confirmed — the bookings that are actually happening, with the
                contact released so the provider can arrange them. */}
            {confirmed.length > 0 && (
                <div>
                    <p className="font-semibold text-gray-900">Coming up</p>
                    <div className="mt-3 space-y-3">
                        {confirmed.map((o) => (
                            <div key={o.id} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                                <div className="text-sm font-medium text-gray-900">
                                    {o.service_date}
                                    {o.guests ? ' · ' + o.guests + ' guest' + (o.guests === 1 ? '' : 's') : ''}
                                    {' · £' + o.price.toFixed(2)}
                                </div>
                                {o.guest_name ? <div className="mt-0.5 text-sm text-gray-700">For {o.guest_name}</div> : null}
                                {o.note ? <p className="mt-1 text-sm text-gray-600 whitespace-pre-line">{o.note}</p> : null}

                                {/* The cottage — photo, name, exact address, link.
                                    Released on confirm, because they have to get
                                    there. The same card the plumber's accepted job
                                    shows, with the address a booked guest gets. */}
                                {o.listing ? (
                                    <a href={'/homes/' + o.listing.id} className="mt-2 flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-2 hover:border-emerald-300">
                                        {o.listing.image ? (
                                            <img src={o.listing.image} alt="" className="h-12 w-12 flex-none rounded-md object-cover" />
                                        ) : <div className="h-12 w-12 flex-none rounded-md bg-gray-100" />}
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-medium text-gray-900">{o.listing.title}</div>
                                            {o.listing.address ? <div className="text-xs text-gray-500">{o.listing.address}</div> : null}
                                        </div>
                                    </a>
                                ) : null}

                                {(o.guest_phone || o.guest_email) ? (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {o.guest_phone ? (
                                            <a href={'tel:' + o.guest_phone} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:border-gray-400">
                                                Call {o.guest_phone}
                                            </a>
                                        ) : null}
                                        {o.guest_email ? (
                                            <a href={'mailto:' + o.guest_email} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:border-gray-400">
                                                Email
                                            </a>
                                        ) : null}
                                    </div>
                                ) : null}

                                <div className="mt-3">
                                    <button
                                        type="button"
                                        disabled={busy === o.id}
                                        onClick={() => answer(o.id, 'refund')}
                                        className="text-xs font-medium text-gray-500 underline hover:text-gray-700 disabled:opacity-60"
                                    >
                                        {busy === o.id ? 'Refunding…' : 'Cancel and refund the guest'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {other.length > 0 && (
                <div>
                    <p className="text-sm font-medium text-gray-500">Earlier</p>
                    <ul className="mt-2 space-y-1 text-sm text-gray-500">
                        {other.map((o) => (
                            <li key={o.id}>
                                {o.service_date} · £{o.price.toFixed(2)} · {STATUS_WORD[o.status] || o.status}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
    );
}
