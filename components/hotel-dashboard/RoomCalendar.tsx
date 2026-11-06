'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type Hotel = { id: string; name: string };
type Room = { id: string; hotel_id: string; name: string; price_per_night: number; inventory_count: number };
type CalData = {
    base_price: number; inventory: number; min_nights: number;
    overrides: Record<string, { is_blocked: boolean; price_override: number | null }>;
    roomsLeft: Record<string, number>;
};

// Per-room-type availability calendar: close dates, seasonal prices, rooms-left
// per date. Modelled on the cottage dashboard calendar. No "today" marker (house
// rule) — past days are greyed; day focus is :focus-visible only (the button's
// default). Tap a day, tap another to make a range, then Manage dates.

function keyOf(d: Date): string {
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
function todayKey(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default function RoomCalendar({ hotels, rooms }: { hotels: Hotel[]; rooms: Room[] }) {
    const [roomId, setRoomId] = useState(rooms[0]?.id || '');
    const [monthStart, setMonthStart] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
    const [data, setData] = useState<CalData | null>(null);
    const [loading, setLoading] = useState(false);
    const [selStart, setSelStart] = useState<string | null>(null);
    const [selEnd, setSelEnd] = useState<string | null>(null);
    const [panelBlocked, setPanelBlocked] = useState(false);
    const [panelPrice, setPanelPrice] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const room = rooms.find((r) => r.id === roomId);
    const today = todayKey();
    const monthEnd = useMemo(() => new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0), [monthStart]);

    const load = useCallback(async () => {
        if (!roomId) return;
        setLoading(true); setError(null);
        try {
            const from = keyOf(monthStart), to = keyOf(monthEnd);
            const res = await fetch(`/api/hotels/calendar?roomType=${roomId}&from=${from}&to=${to}`);
            const body = await res.json().catch(() => ({}));
            if (body.ok) setData(body); else setError(body.error || 'Could not load the calendar.');
        } catch { setError('Something went wrong loading the calendar.'); }
        setLoading(false);
    }, [roomId, monthStart, monthEnd]);

    useEffect(() => { load(); }, [load]);

    // 6-week grid, Monday-first.
    const cells = useMemo(() => {
        const firstDow = (monthStart.getDay() + 6) % 7; // Mon=0
        const start = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - firstDow);
        return Array.from({ length: 42 }, (_, i) => {
            const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            return { date: d, key: keyOf(d), inMonth: d.getMonth() === monthStart.getMonth() };
        });
    }, [monthStart]);

    const selectedKeys = useMemo(() => {
        if (!selStart) return [];
        const a = selStart, b = selEnd || selStart;
        const lo = a <= b ? a : b, hi = a <= b ? b : a;
        return cells.filter((c) => c.key >= lo && c.key <= hi && c.key >= today).map((c) => c.key);
    }, [selStart, selEnd, cells, today]);

    function tapDay(key: string) {
        if (key < today) return;
        if (!selStart || (selStart && selEnd)) { setSelStart(key); setSelEnd(null); seedPanel([key]); return; }
        setSelEnd(key);
        const lo = key < selStart ? key : selStart, hi = key < selStart ? selStart : key;
        seedPanel(cells.filter((c) => c.key >= lo && c.key <= hi && c.key >= today).map((c) => c.key));
    }
    function seedPanel(keys: string[]) {
        if (!data) return;
        const blocked = keys.every((k) => data.overrides[k]?.is_blocked);
        setPanelBlocked(!!keys.length && blocked);
        const prices = Array.from(new Set(keys.map((k) => data.overrides[k]?.price_override ?? null)));
        setPanelPrice(prices.length === 1 && prices[0] != null ? String(prices[0]) : '');
    }

    async function save() {
        if (!selectedKeys.length || !data) return;
        setSaving(true); setError(null);
        try {
            const res = await fetch('/api/hotels/calendar', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    roomTypeId: roomId, dates: selectedKeys,
                    is_blocked: panelBlocked,
                    price_override: panelPrice.trim() === '' ? '' : Number(panelPrice),
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (!body.ok) { setError(body.error || 'Could not save.'); setSaving(false); return; }
            setSelStart(null); setSelEnd(null);
            await load();
        } catch { setError('Something went wrong saving.'); }
        setSaving(false);
    }
    async function reset() {
        if (!selectedKeys.length) return;
        setSaving(true);
        try {
            await fetch('/api/hotels/calendar', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomTypeId: roomId, dates: selectedKeys }) });
            setSelStart(null); setSelEnd(null);
            await load();
        } catch { setError('Something went wrong.'); }
        setSaving(false);
    }

    const monthLabel = monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
                <div className="flex items-center gap-3 mb-5">
                    <Link href="/dashboard" className="text-sm font-semibold text-emerald-700 hover:underline">← Dashboard</Link>
                    <h1 className="text-2xl font-bold text-slate-900">Availability &amp; prices</h1>
                </div>

                <div className="mb-4">
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Room type</label>
                    <select value={roomId} onChange={(e) => { setRoomId(e.target.value); setSelStart(null); setSelEnd(null); }}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm bg-white">
                        {rooms.map((r) => (
                            <option key={r.id} value={r.id}>{hotels.length > 1 ? `${hotels.find((h) => h.id === r.hotel_id)?.name} — ` : ''}{r.name} ({r.inventory_count} rooms · £{Number(r.price_per_night).toFixed(0)})</option>
                        ))}
                    </select>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between mb-3">
                        <button type="button" onClick={() => setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1))} className="rounded-lg p-2 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
                        <span className="font-semibold text-slate-900">{monthLabel}</span>
                        <button type="button" onClick={() => setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1))} className="rounded-lg p-2 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
                    </div>
                    <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-slate-400 mb-1">
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{d}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                        {cells.map((c) => {
                            const isPast = c.key < today;
                            const ov = data?.overrides[c.key];
                            const blocked = ov?.is_blocked;
                            const price = ov?.price_override ?? data?.base_price;
                            const left = data?.roomsLeft[c.key];
                            const selected = selectedKeys.includes(c.key);
                            return (
                                <button key={c.key} type="button" disabled={isPast} onClick={() => tapDay(c.key)}
                                    className={`flex flex-col min-h-[58px] sm:min-h-[76px] rounded-lg border text-left p-1.5 transition
                                        ${!c.inMonth ? 'opacity-40' : ''}
                                        ${isPast ? 'bg-slate-50 text-slate-300 cursor-default border-slate-100' :
                                          selected ? 'border-emerald-700 bg-emerald-50 ring-1 ring-emerald-700' :
                                          blocked ? 'border-slate-200 bg-slate-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                                    <span className={`text-xs ${isPast ? '' : 'text-slate-700'}`}>{c.date.getDate()}</span>
                                    {!isPast && c.inMonth && data && (
                                        <span className="mt-auto leading-tight">
                                            {blocked ? (
                                                <span className="text-[10px] font-semibold text-slate-400">Closed</span>
                                            ) : (
                                                <>
                                                    <span className="block text-[10px] text-slate-500">£{Number(price).toFixed(0)}</span>
                                                    <span className={`block text-[10px] font-semibold ${(left ?? 0) <= 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{(left ?? 0) <= 0 ? 'Sold out' : `${left} left`}</span>
                                                </>
                                            )}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    {loading && <p className="mt-2 text-xs text-slate-400">Loading…</p>}
                    {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
                </div>

                {selectedKeys.length > 0 && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                        <h2 className="font-bold text-slate-900 mb-2">Manage {selectedKeys.length} date{selectedKeys.length === 1 ? '' : 's'}</h2>
                        <label className="flex items-center justify-between py-2">
                            <span className="text-sm text-slate-800">Close this room type (no bookings)</span>
                            <button type="button" onClick={() => setPanelBlocked((v) => !v)} className={`relative h-6 w-11 rounded-full transition ${panelBlocked ? 'bg-slate-800' : 'bg-slate-300'}`}>
                                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${panelBlocked ? 'left-5' : 'left-0.5'}`} />
                            </button>
                        </label>
                        <label className="block mt-2">
                            <span className="text-sm text-slate-800">Price for these nights (£)</span>
                            <input type="number" min={1} value={panelPrice} onChange={(e) => setPanelPrice(e.target.value)}
                                placeholder={`Default £${Number(data?.base_price).toFixed(0)}`}
                                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                        </label>
                        <div className="mt-3 flex items-center gap-2">
                            <button type="button" onClick={save} disabled={saving} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
                            <button type="button" onClick={reset} disabled={saving} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">Reset to default</button>
                            <button type="button" onClick={() => { setSelStart(null); setSelEnd(null); }} className="ml-auto text-sm text-slate-500 hover:text-slate-800">Clear</button>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}
