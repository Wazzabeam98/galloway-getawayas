'use client';

import { useCallback, useEffect, useState } from 'react';
import { dateLabel, timeLabel } from '@/components/marketplace/present';

// A slot provider's home — a diary, not an inbox. There is nothing to confirm:
// the booking already happened and the money is already taken. So this shows the
// week they've been booked for, with who is coming, and the two things they can
// still do — block a day, or cancel a booking (which refunds the guest and
// reopens the seat). Same payouts gate as the other shapes.

interface Order {
    id: string; status: string; service_date: string; service_time: string | null; shape: string;
    price: number; quantity: number | null; item_name: string | null; item_unit: string | null;
    guest_name: string | null; guest_phone: string | null; guest_email: string | null;
}

export default function ProviderSlotDashboard({ providerId }: { providerId: string }) {
    const [payouts, setPayouts] = useState<null | { connected: boolean; payouts_enabled: boolean }>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [blocks, setBlocks] = useState<string[]>([]);
    const [blockDate, setBlockDate] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadPayouts = useCallback(async () => {
        try {
            const r = await fetch('/api/services/connect?provider=' + encodeURIComponent(providerId));
            const d = await r.json();
            setPayouts({ connected: !!(d && d.connected), payouts_enabled: !!(d && d.payouts_enabled) });
        } catch { /* leave null */ }
    }, [providerId]);

    const loadOrders = useCallback(async () => {
        try {
            const r = await fetch('/api/services/orders?provider=' + encodeURIComponent(providerId));
            const d = await r.json();
            setOrders(((d && d.orders) || []).filter((o: Order) => o.shape === 'slot'));
        } catch { /* ignore */ }
    }, [providerId]);

    const loadSchedule = useCallback(async () => {
        try {
            const r = await fetch('/api/services/slots/schedule?provider=' + encodeURIComponent(providerId));
            const d = await r.json();
            if (d && d.ok) setBlocks(d.blocks || []);
        } catch { /* ignore */ }
    }, [providerId]);

    useEffect(() => { loadPayouts(); loadOrders(); loadSchedule(); }, [loadPayouts, loadOrders, loadSchedule]);

    async function setUpPayouts() {
        setBusy('payouts'); setError(null);
        try {
            const r = await fetch('/api/services/connect', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId }),
            });
            const d = await r.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start payout setup.');
        } catch { setError('Could not start payout setup.'); }
        setBusy(null);
    }

    async function refund(orderId: string) {
        if (typeof window !== 'undefined' && !window.confirm('Cancel this booking and refund the guest in full? This can’t be undone.')) return;
        setBusy(orderId); setError(null);
        try {
            const r = await fetch('/api/services/orders/respond', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, decision: 'refund' }),
            });
            const d = await r.json();
            if (!d || !d.ok) setError((d && d.error) || 'Could not do that.');
            await loadOrders();
        } catch { setError('Could not do that.'); }
        setBusy(null);
    }

    async function toggleBlock(date: string, on: boolean) {
        setBusy('block'); setError(null);
        const next = on ? Array.from(new Set([...blocks, date])) : blocks.filter((b) => b !== date);
        try {
            const r = await fetch('/api/services/slots/schedule', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, blocks: next }),
            });
            const d = await r.json();
            if (d && d.ok) { setBlocks(next); setBlockDate(''); }
            else setError((d && d.error) || 'Could not save that.');
        } catch { setError('Could not save that.'); }
        setBusy(null);
    }

    const live = payouts && payouts.payouts_enabled;
    const todayIso = new Date().toISOString().slice(0, 10);
    const confirmed = orders.filter((o) => o.status === 'confirmed' && o.service_date >= todayIso)
        .sort((a, b) => (a.service_date === b.service_date ? String(a.service_time).localeCompare(String(b.service_time)) : a.service_date.localeCompare(b.service_date)));
    const earlier = orders.filter((o) => !(o.status === 'confirmed' && o.service_date >= todayIso));

    // Group the upcoming week by day.
    const byDay: { date: string; rows: Order[] }[] = [];
    for (const o of confirmed) {
        const last = byDay[byDay.length - 1];
        if (last && last.date === o.service_date) last.rows.push(o);
        else byDay.push({ date: o.service_date, rows: [o] });
    }

    return (
        <div className="mt-5 space-y-6">
            {!live && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                    <p className="font-semibold text-amber-900">One step before guests can book you</p>
                    <p className="mt-1 text-sm text-amber-900/80">Set up payouts so we can pay you. You won’t appear to guests until this is done.</p>
                    <button type="button" disabled={busy === 'payouts'} onClick={setUpPayouts}
                        className="mt-3 rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                        {busy === 'payouts' ? 'Starting…' : (payouts && payouts.connected ? 'Finish setting up payouts' : 'Set up payouts')}
                    </button>
                </div>
            )}
            {live && <p className="text-sm text-emerald-800">Payouts are set up — you’re live to guests.</p>}

            {/* The diary */}
            <div>
                <p className="font-semibold text-gray-900">Your booked times</p>
                {byDay.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-500">Nothing booked yet. When a guest books a time, it appears here — you don’t need to confirm anything.</p>
                ) : (
                    <div className="mt-3 space-y-4">
                        {byDay.map((day) => (
                            <div key={day.date}>
                                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{dateLabel(day.date)}</div>
                                <div className="mt-2 space-y-2">
                                    {day.rows.map((o) => (
                                        <div key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
                                            <span className="text-sm font-semibold text-gray-900">{o.service_time ? timeLabel(o.service_time) : ''}</span>
                                            <span className="text-sm text-gray-700">{o.item_name}</span>
                                            {o.quantity && o.quantity > 1 ? <span className="text-sm text-gray-500">· {o.quantity} people</span> : null}
                                            <span className="text-sm text-gray-500">· £{o.price.toFixed(2)}</span>
                                            {o.guest_name ? <span className="text-sm text-gray-500">· {o.guest_name}</span> : null}
                                            <span className="ml-auto flex items-center gap-2">
                                                {o.guest_phone ? <a href={'tel:' + o.guest_phone} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-gray-400">Call</a> : null}
                                                {o.guest_email ? <a href={'mailto:' + o.guest_email} className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-gray-400">Email</a> : null}
                                                <button type="button" disabled={busy === o.id} onClick={() => refund(o.id)}
                                                    className="text-xs font-medium text-gray-500 underline hover:text-gray-700 disabled:opacity-60">
                                                    {busy === o.id ? 'Refunding…' : 'Cancel & refund'}
                                                </button>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Block a day */}
            <div className="rounded-xl border border-gray-200 p-4">
                <p className="text-sm font-semibold text-gray-900">Days off</p>
                <p className="mt-0.5 text-sm text-gray-500">Block a day and none of its times can be booked. Existing bookings aren’t affected.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="date" min={todayIso} value={blockDate} onChange={(e) => setBlockDate(e.target.value)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
                    <button type="button" disabled={!blockDate || busy === 'block'} onClick={() => blockDate && toggleBlock(blockDate, true)}
                        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Block this day</button>
                </div>
                {blocks.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {blocks.map((b) => (
                            <span key={b} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
                                {dateLabel(b)}
                                <button type="button" onClick={() => toggleBlock(b, false)} aria-label="Unblock" className="text-gray-400 hover:text-gray-700">×</button>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {earlier.length > 0 && (
                <div>
                    <p className="text-sm font-medium text-gray-500">Earlier</p>
                    <ul className="mt-2 space-y-1 text-sm text-gray-500">
                        {earlier.map((o) => (
                            <li key={o.id}>{dateLabel(o.service_date)}{o.service_time ? ' · ' + timeLabel(o.service_time) : ''} · £{o.price.toFixed(2)} · {o.status}</li>
                        ))}
                    </ul>
                </div>
            )}

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
    );
}
