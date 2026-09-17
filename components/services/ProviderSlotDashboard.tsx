'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, MessageSquare, CalendarPlus, Clock, Trash2, X, ChevronLeft, ChevronRight, CalendarDays, LayoutGrid, ArrowLeft } from 'lucide-react';
import { dateLabel, timeLabel } from '@/components/marketplace/present';
import { londonDayKey, shiftDayKey } from '@/lib/dayKey';
import SlotCalendar, { type DayShape } from '@/components/services/SlotCalendar';
import SlotDayView from '@/components/services/SlotDayView';
import { daySlots, dayTicks, type DayInputs, type DaySlotRow } from '@/lib/slotDay';
import { seatConfig } from '@/lib/serviceSlots';
import Link from 'next/link';
import { orderReference, orderNet } from '@/lib/serviceOrders';
import { OptionPills, Stepper, SESSION_LENGTH_OPTIONS, minutesLabel } from '@/components/services/editorControls';

interface Order {
    id: string; status: string; service_date: string; service_time: string | null; shape: string;
    price: number; quantity: number | null; attendees: number | null; item_name: string | null; item_unit: string | null;
    guest_name: string | null; guest_phone: string | null; guest_email: string | null;
    fulfilment?: string | null; service_address?: string | null;
    commission_rate?: number | null; amount_refunded?: number | null; unit_price?: number | null;
    note?: string | null; created_at?: string | null;
}

// Money + the label/value Row + the titled Card — the same atoms the cottage
// booking detail (app/dashboard/bookings/[id]) is built from, so an experience
// booking reads in the same language rather than a second invented one.
const money = (value: number) => '£' + Number(value || 0).toFixed(2);
function Row({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-6 border-b border-slate-100 py-2 last:border-0">
            <div className="text-sm text-slate-500">{label}</div>
            <div className={'text-right text-sm ' + (muted ? 'text-slate-500' : 'font-medium text-slate-900')}>{value}</div>
        </div>
    );
}
function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">{title}</h3>
            {children}
        </div>
    );
}
// Initials from a name — no profile photos; a name and its initials are enough.
function initialsOf(name: string | null): string {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
// What a booking's party reads as: per-person books seats, a private hire books a party.
function partyLabel(o: Order): string {
    const n = Number(o.item_unit === 'person' ? o.quantity : (o.attendees || o.quantity)) || 1;
    if (o.item_unit === 'person') return n + (n === 1 ? ' place' : ' places');
    return 'Party of ' + n;
}
// The money split for an order — the provider's take leads the list (a gross
// figure there reads as their money and it isn't). Delegates to the shared
// lib/serviceOrders.orderNet, so the list, the detail and the earnings page can
// never disagree.
const providerTake = orderNet;
interface SlotSession { date: string; time: string; capacity: number; seats_taken: number; seats_left: number; private: boolean; closed: boolean; sold: { item_name: string; unit: string; seats: number }[] }
interface DeclaredSession { id: string; date: string; time: string; capacity: number; seats_taken: number; title: string | null; duration_minutes?: number | null }
interface DraftSession { time: string; duration: number; capacity: number; title: string }

const isTime = (t: string) => /^\d{2}:\d{2}$/.test(t);
const keyOf = (date: string, time: string) => date + ' ' + String(time).slice(0, 5);
const minutesOf = (t: string) => { const [h, m] = String(t).split(':'); return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0); };
const isNarrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;
function daysBetween(a: string, b: string): string[] { const [lo, hi] = a <= b ? [a, b] : [b, a]; const out: string[] = []; let d = new Date(lo + 'T00:00:00Z'); const end = new Date(hi + 'T00:00:00Z'); for (let g = 0; g < 400 && d <= end; g++) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); } return out; }

export default function ProviderSlotDashboard({ providerId, editHref }: { providerId: string; editHref?: string }) {
    const [payouts, setPayouts] = useState<null | { connected: boolean; payouts_enabled: boolean }>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [sessions, setSessions] = useState<SlotSession[]>([]);
    const [blocks, setBlocks] = useState<string[]>([]);
    const [availability, setAvailability] = useState<Array<{ day_of_week: number; open_time: string; close_time: string }>>([]);
    const [hasHours, setHasHours] = useState<boolean | null>(null);
    const [partialBlocks, setPartialBlocks] = useState<Array<{ id: string; date: string; start: string; end: string }>>([]);
    const [declaredSessions, setDeclaredSessions] = useState<DeclaredSession[]>([]);
    const [slotDefaults, setSlotDefaults] = useState<{ duration: number; capacity: number }>({ duration: 60, capacity: 1 });
    const [slotMin, setSlotMin] = useState(1);
    const [items, setItems] = useState<Array<{ unit: string; capacity: number | null; min_people: number | null; active: boolean; price: number }>>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    // A load that FAILED (network/server), so an empty calendar can say so rather
    // than looking like a quiet week.
    const [loadFailed, setLoadFailed] = useState(false);

    const todayIso = londonDayKey();
    const [view, setView] = useState<'month' | 'day'>('month');
    const [dayDate, setDayDate] = useState<string>(todayIso);
    // The right rail's mode: nothing, a session's detail, or the add-sessions
    // builder (for a clicked free slot, or a shift-selected set of days).
    const [panel, setPanel] = useState<'none' | 'detail' | 'add' | 'bulk'>('none');
    const [activeKey, setActiveKey] = useState<string | null>(null);
    // Within a session's detail: which guest's booking is open (null = the list),
    // and whether that booking's message thread is showing.
    const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [anchor, setAnchor] = useState<string | null>(null);

    // Builder draft/list.
    const [dTime, setDTime] = useState('');
    const [dDur, setDDur] = useState(60);
    const [dCap, setDCap] = useState(1);
    const [dTitle, setDTitle] = useState('');
    const [pending, setPending] = useState<DraftSession[]>([]);
    // Day-view part-day block range.
    const [pbStart, setPbStart] = useState(''); const [pbEnd, setPbEnd] = useState('');

    const railRef = useRef<HTMLDivElement | null>(null);

    const loadPayouts = useCallback(async () => { try { const r = await fetch('/api/services/connect?provider=' + encodeURIComponent(providerId)); const d = await r.json(); setPayouts({ connected: !!(d && d.connected), payouts_enabled: !!(d && d.payouts_enabled) }); } catch { setLoadFailed(true); } }, [providerId]);
    const loadOrders = useCallback(async () => { try { const r = await fetch('/api/services/orders?provider=' + encodeURIComponent(providerId)); const d = await r.json(); if (!r.ok) throw new Error('boom'); setOrders(((d && d.orders) || []).filter((o: Order) => o.shape === 'slot')); } catch { setLoadFailed(true); } }, [providerId]);
    const loadSchedule = useCallback(async () => {
        try { const r = await fetch('/api/services/slots/schedule?provider=' + encodeURIComponent(providerId)); const d = await r.json();
            if (d && d.ok) {
                setBlocks(d.blocks || []); setAvailability(d.availability || []); setHasHours((d.availability || []).length > 0);
                setDeclaredSessions(d.declaredSessions || []);
                const dur = Number(d.slot_length_minutes) || 60, cap = Number(d.slot_capacity) || 1;
                setSlotDefaults({ duration: dur, capacity: cap }); setSlotMin(Number(d.slot_min_people) || 1); setItems(d.items || []);
                setDDur((v) => v === 60 ? dur : v); setDCap((v) => v === 1 ? cap : v);
            }
        } catch { setLoadFailed(true); }
    }, [providerId]);
    const loadSessions = useCallback(async () => { try { const r = await fetch('/api/services/slots/sessions?provider=' + encodeURIComponent(providerId)); const d = await r.json(); if (d && d.ok) setSessions(d.sessions || []); } catch { setLoadFailed(true); } }, [providerId]);
    const loadPartialBlocks = useCallback(async () => { try { const r = await fetch('/api/services/slots/blocks?provider=' + encodeURIComponent(providerId)); const d = await r.json(); if (d && d.ok) setPartialBlocks(d.blocks || []); } catch { setLoadFailed(true); } }, [providerId]);

    const reloadAll = useCallback(() => { setLoadFailed(false); loadPayouts(); loadOrders(); loadSchedule(); loadSessions(); loadPartialBlocks(); }, [loadPayouts, loadOrders, loadSchedule, loadSessions, loadPartialBlocks]);
    useEffect(() => { reloadAll(); }, [reloadAll]);
    // Phones open on the day, not the month.
    useEffect(() => { if (isNarrow()) setView('day'); }, []);
    useEffect(() => { if (panel !== 'none' && isNarrow()) railRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [panel, activeKey, dayDate]);

    // ---- handlers -------------------------------------------------------------
    async function setUpPayouts() { setBusy('payouts'); setError(null); try { const r = await fetch('/api/services/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId }) }); const d = await r.json(); if (d && d.ok && d.url) { window.location.href = d.url; return; } setError((d && d.error) || 'Could not start payout setup.'); } catch { setError('Could not start payout setup.'); } setBusy(null); }
    async function refund(orderId: string) { if (typeof window !== 'undefined' && !window.confirm('Cancel this booking and refund the guest in full? This can’t be undone.')) return; setBusy(orderId); setError(null); try { const r = await fetch('/api/services/orders/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, decision: 'refund' }) }); const d = await r.json(); if (!d || !d.ok) setError((d && d.error) || 'Could not do that.'); await Promise.all([loadOrders(), loadSessions()]); } catch { setError('Could not do that.'); } setBusy(null); }
    async function toggleDayOff(date: string, on: boolean) { setBusy('block'); setError(null); setNotice(null); const next = on ? Array.from(new Set([...blocks, date])) : blocks.filter((b) => b !== date); try { const r = await fetch('/api/services/slots/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, blocks: next }) }); const d = await r.json(); if (d && d.ok) setBlocks(next); else setError((d && d.error) || 'Could not save that.'); } catch { setError('Could not save that.'); } setBusy(null); }
    async function blockDays(dates: string[], on: boolean) { setBusy('block'); setError(null); setNotice(null); const next = on ? Array.from(new Set([...blocks, ...dates])) : blocks.filter((b) => !dates.includes(b)); try { const r = await fetch('/api/services/slots/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, blocks: next }) }); const d = await r.json(); if (d && d.ok) { setBlocks(next); setNotice(`${on ? 'Blocked' : 'Reopened'} ${dates.length} day${dates.length === 1 ? '' : 's'}.`); } else setError((d && d.error) || 'Could not save that.'); } catch { setError('Could not save that.'); } setBusy(null); }
    async function addPartialBlock(date: string, start: string, end: string) { if (!date || !start || !end) return; setBusy('pblock'); setError(null); try { const r = await fetch('/api/services/slots/blocks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, date, start, end }) }); const d = await r.json(); if (d && d.ok) { await loadPartialBlocks(); setPbStart(''); setPbEnd(''); } else setError((d && d.error) || 'Could not block that time.'); } catch { setError('Could not block that time.'); } setBusy(null); }
    async function removePartialBlock(id: string) { setBusy(id); setError(null); try { const r = await fetch('/api/services/slots/blocks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, id }) }); const d = await r.json(); if (d && d.ok) await loadPartialBlocks(); else setError((d && d.error) || 'Could not remove that block.'); } catch { setError('Could not remove that block.'); } setBusy(null); }
    async function addSessions(dates: string[], toAdd: DraftSession[]) {
        setBusy('declare'); setError(null); setNotice(null);
        try {
            const r = await fetch('/api/services/slots/sessions/declare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, dates, sessions: toAdd.map((s) => ({ time: s.time, durationMinutes: s.duration, capacity: s.capacity, title: s.title })) }) });
            const d = await r.json();
            if (!d || !d.ok) { setError((d && d.error) || 'Could not add the sessions.'); setBusy(null); return; }
            const skipped = (d.results || []).filter((x: any) => !x.ok);
            const skipList = skipped.map((x: any) => `${dateLabel(x.date)} ${timeLabel(x.time + ':00')} — ${x.reason}`).join('; ');
            if (d.added > 0 && skipped.length === 0) setNotice(`Added ${d.added} session${d.added === 1 ? '' : 's'}.`);
            else if (d.added > 0) setNotice(`Added ${d.added} session${d.added === 1 ? '' : 's'}. ${skipped.length} skipped — ${skipList}.`);
            else setError('No sessions added. ' + skipList + '.');
            await Promise.all([loadSchedule(), loadSessions()]);
            setPending([]); setDTime(''); setDTitle(''); setPanel('none'); setSelected(new Set());
        } catch { setError('Could not add the sessions.'); }
        setBusy(null);
    }
    async function removeDeclared(id: string) { setBusy(id); setError(null); setNotice(null); try { const r = await fetch('/api/services/slots/sessions/declare', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, id }) }); const d = await r.json(); if (d && d.ok) { setPanel('none'); setActiveKey(null); await loadSchedule(); } else setError((d && d.error) || 'Could not remove that session.'); } catch { setError('Could not remove that session.'); } setBusy(null); }

    // ---- derived --------------------------------------------------------------
    // What a free slot could hold — resolved through seatConfig (item wins, else
    // the provider default) across EVERY active priced item, so the calendar can't
    // disagree with the guest panel or the book route. A whole-session provider
    // still has a capacity (its slot_capacity — the party a private hire holds), so
    // an open slot reads "N of N free" rather than a numberless "Free". Falls back
    // to the provider default when no item resolves one.
    const pricedItems = items.filter((it) => it.active && it.price > 0);
    const itemCaps = pricedItems
        .map((it) => Number(seatConfig(it.capacity, it.min_people, { slot_capacity: slotDefaults.capacity, slot_min_people: slotMin }).slot_capacity) || 0)
        .filter((c) => c > 0);
    const freeCapacity = (itemCaps.length ? Math.max(...itemCaps) : slotDefaults.capacity) || null;
    // Whether an open slot sells SEATS (a per-person item exists) or is a
    // whole-session hire. "N free" reads as seats to sell — right for a shared
    // slot, wrong for a private hire, which is "Open · up to N".
    const freeShared = pricedItems.some((it) => String(it.unit) === 'person');
    const dayInputs: DayInputs = {
        availabilityRows: availability,
        slotLen: slotDefaults.duration,
        blockedDates: blocks,
        partialBlocks: partialBlocks.map((b) => ({ date: b.date, startMin: minutesOf(b.start), endMin: minutesOf(b.end), id: b.id })),
        sessions,
        declared: declaredSessions,
        freeCapacity,
    };
    // Month shapes for a rolling window.
    const shapeByDate: Record<string, DayShape> = {};
    { let d = todayIso; for (let n = 0; n < 150; n++) { const data = daySlots(d, dayInputs); shapeByDate[d] = { ticks: dayTicks(data), booked: data.booked, added: data.added, free: data.free, dayOff: data.dayOff }; d = shiftDayKey(d, 1); } }
    const dayData = daySlots(dayDate, dayInputs);

    const confirmed = orders.filter((o) => o.status === 'confirmed' && o.service_date >= todayIso);
    const ordersByKey: Record<string, Order[]> = {};
    for (const o of confirmed) (ordersByKey[keyOf(o.service_date, o.service_time || '')] = ordersByKey[keyOf(o.service_date, o.service_time || '')] || []).push(o);
    const activeRow = activeKey ? dayData.rows.find((r) => keyOf(dayDate, r.time) === activeKey) || null : null;
    const activeOrders = activeKey ? (ordersByKey[activeKey] || []) : [];

    const live = payouts && payouts.payouts_enabled;
    const nowMin = (() => { try { const s = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour12: false }); return minutesOf(s); } catch { return -1; } })();

    // ---- builder helpers ------------------------------------------------------
    const draftValid = isTime(dTime);
    const addDraft = () => { if (!draftValid) return; setPending((p) => [...p, { time: dTime, duration: dDur, capacity: dCap, title: dTitle.trim() }]); setDTime(''); setDTitle(''); };
    const toCommit: DraftSession[] = [...pending, ...(draftValid ? [{ time: dTime, duration: dDur, capacity: dCap, title: dTitle.trim() }] : [])];
    const builderDates = panel === 'bulk' ? Array.from(selected).sort() : [dayDate];
    const commit = () => { if (!toCommit.length || !builderDates.length) return; addSessions(builderDates, toCommit); };
    const lengthOpts = Array.from(new Set([...SESSION_LENGTH_OPTIONS, slotDefaults.duration || 60])).sort((a, b) => a - b);

    const openDay = (date: string) => { setDayDate(date); setView('day'); setPanel('none'); setActiveKey(null); setSelected(new Set()); };
    const onMonthDayClick = (date: string, shift: boolean) => {
        if (shift) { setSelected((prev) => { const next = new Set(prev); if (anchor) { for (const dd of daysBetween(anchor, date)) if (dd >= todayIso) next.add(dd); } else if (next.has(date)) next.delete(date); else next.add(date); return next; }); setAnchor(date); setPanel('bulk'); setDTime(''); setPending([]); }
        else openDay(date);
    };
    const openRow = (row: DaySlotRow) => { setActiveKey(keyOf(dayDate, row.time)); setPanel('detail'); setActiveOrderId(null); };
    const addAt = (time: string) => { setDTime(time); setDDur(slotDefaults.duration || 60); setDCap(slotDefaults.capacity || 1); setDTitle(''); setPending([]); setPanel('add'); };

    const fillLine = (r: DaySlotRow) => r.kind === 'private' ? 'Private hire — whole session' : `${r.seatsTaken || 0} of ${r.capacity || 0} booked${(r.seatsLeft || 0) > 0 ? ` · ${r.seatsLeft} left` : ' · full'}`;

    // The one-line read on the day — so an open, unbooked day says "8 open" rather
    // than looking like nothing's set up.
    const openCount = dayData.rows.filter((r) => r.kind === 'free').length;
    const daySummary = dayData.dayOff ? 'Day off — nothing bookable'
        : (() => {
            const parts: string[] = [];
            if (dayData.booked) parts.push(`${dayData.booked} booked`);
            if (dayData.added) parts.push(`${dayData.added} class${dayData.added === 1 ? '' : 'es'} to fill`);
            if (openCount) parts.push(`${openCount} open`);
            if (dayData.bands.length) parts.push(`${dayData.bands.length} blocked`);
            return parts.length ? parts.join(' · ') : 'No hours set — nothing bookable';
        })();

    // A shared builder block (used for a free-slot add and a multi-day bulk add).
    const Builder = (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><CalendarPlus className="h-4 w-4 text-violet-700" aria-hidden /><p className="text-sm font-bold text-slate-900">Add sessions</p></div>
                <button type="button" onClick={() => { setPanel('none'); setSelected(new Set()); }} className="text-slate-400 hover:text-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">{panel === 'bulk' ? `On ${builderDates.length} selected day${builderDates.length === 1 ? '' : 's'}.` : `On ${dateLabel(dayDate)}.`} A dated class or one-off, on top of your weekly hours. A time that clashes is skipped.</p>
            <div className="mt-3 space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Time
                    <input type="time" value={dTime} onChange={(e) => setDTime(e.target.value)} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
                </label>
                <div><span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Length</span><div className="mt-1"><OptionPills options={lengthOpts.map((m) => ({ value: String(m), label: minutesLabel(m) }))} value={String(dDur)} onChange={(v) => setDDur(Number(v))} /></div></div>
                <div><span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Capacity</span><div className="mt-1"><Stepper value={dCap} onChange={setDCap} min={1} max={60} /></div></div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Name (optional)
                    <input type="text" value={dTitle} onChange={(e) => setDTitle(e.target.value)} placeholder="e.g. Sunset session" className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
                </label>
                <button type="button" onClick={addDraft} disabled={!draftValid} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-500 disabled:opacity-40">+ Add another</button>
            </div>
            {toCommit.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                    {toCommit.map((s, i) => (
                        <li key={i} className="flex items-center gap-2 rounded-xl bg-violet-50 px-2.5 py-1.5 text-sm ring-1 ring-violet-200">
                            <Clock className="h-3.5 w-3.5 flex-none text-violet-700" aria-hidden /><span className="font-semibold text-slate-900">{timeLabel(s.time + ':00')}</span>
                            <span className="text-xs text-slate-500">{minutesLabel(s.duration)} · up to {s.capacity}{s.title ? ` · ${s.title}` : ''}</span>
                            {i < pending.length ? <button type="button" onClick={() => setPending((p) => p.filter((_, j) => j !== i))} className="ml-auto text-slate-400 hover:text-red-600" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button> : <span className="ml-auto text-[10px] font-semibold uppercase text-slate-400">draft</span>}
                        </li>
                    ))}
                </ul>
            )}
            <button type="button" onClick={commit} disabled={!toCommit.length || busy === 'declare'} className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                {busy === 'declare' ? 'Adding…' : `Add ${toCommit.length || ''} session${toCommit.length === 1 ? '' : 's'}${panel === 'bulk' ? ` to ${builderDates.length} days` : ''}`.replace('  ', ' ')}
            </button>
            {panel === 'add' && isTime(dTime) && (
                <button type="button" onClick={() => addPartialBlock(dayDate, dTime, minutesToHHMM(minutesOf(dTime) + (slotDefaults.duration || 60)))} disabled={busy === 'pblock'} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-slate-500 disabled:opacity-50">Block this time instead</button>
            )}
        </div>
    );

    // A single guest's booking, in the cottage detail's language: reference, when,
    // what they booked, party, a cost breakdown, when they booked and what they
    // paid — plus Call, an in-app Message thread, and Cancel & refund.
    const BookingDetail = (o: Order) => {
        const { rate, refunded, fee, youGet: yours } = providerTake(o);
        const perPerson = o.item_unit === 'person' && o.unit_price && (o.quantity || 0) > 1;
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between">
                    <button type="button" onClick={() => setActiveOrderId(null)} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3.5 w-3.5" />All guests</button>
                    <button type="button" onClick={() => { setPanel('none'); setActiveKey(null); setActiveOrderId(null); }} className="text-slate-400 hover:text-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
                </div>

                <div className="mt-2 flex items-center gap-3">
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">{initialsOf(o.guest_name)}</span>
                    <div className="min-w-0">
                        <p className="truncate text-base font-bold text-slate-900">{o.guest_name || 'Guest'}</p>
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{orderReference(o.id)}</p>
                    </div>
                </div>

                <div className="mt-3 space-y-3">
                    <DetailCard title="Booking">
                        <Row label="When" value={`${dateLabel(o.service_date)} · ${timeLabel((o.service_time || '') + '')}`} />
                        <Row label="What they booked" value={o.item_name || 'Session'} />
                        <Row label="Party" value={partyLabel(o)} />
                        {o.fulfilment === 'delivery' && o.service_address ? <Row label="Where" value={o.service_address} /> : null}
                        {o.created_at ? <Row label="Booked on" value={dateLabel(String(o.created_at).slice(0, 10))} muted /> : null}
                    </DetailCard>

                    <DetailCard title="Money">
                        <Row label="Guest paid in total" value={money(o.price || 0)} />
                        {perPerson ? <Row label={`${o.quantity} × ${money(Number(o.unit_price))} per person`} value={money(o.price || 0)} muted /> : null}
                        {refunded > 0 ? <Row label="Refunded to guest" value={'−' + money(refunded)} /> : null}
                        <Row label={`Our fee (${Math.round(rate * 100)}%)`} value={'−' + money(fee)} muted />
                        <Row label="You get" value={money(yours)} />
                        <Row label="Payment" value="Paid in full at booking" muted />
                    </DetailCard>

                    {o.note ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">From the guest</p>
                            <p className="mt-1 whitespace-pre-line text-sm text-amber-900">{o.note}</p>
                        </div>
                    ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {o.guest_phone ? <a href={'tel:' + o.guest_phone} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400"><Phone className="h-4 w-4" />Call</a> : null}
                    {/* Message opens the real thread in the messages section — the
                        same surface the inbox links to — not a panel inside the
                        calendar. The thread masks the guest's address and emails
                        them a link back. */}
                    <Link href={`/services/messages/order/${o.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400"><MessageSquare className="h-4 w-4" />Message</Link>
                    <button type="button" disabled={busy === o.id} onClick={() => refund(o.id)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:text-red-600 disabled:opacity-60"><Trash2 className="h-4 w-4" />{busy === o.id ? 'Refunding…' : 'Cancel & refund'}</button>
                </div>
            </div>
        );
    };

    const activeOrder = activeOrderId ? activeOrders.find((o) => o.id === activeOrderId) || null : null;

    const Detail = activeRow && (
        activeOrder ? BookingDetail(activeOrder) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between">
                <div><p className="text-sm font-bold text-slate-900">{dateLabel(dayDate)}</p><p className="text-sm text-slate-500">{timeLabel(activeRow.time + ':00')}{activeRow.title ? ` · ${activeRow.title}` : ''}</p></div>
                <button type="button" onClick={() => { setPanel('none'); setActiveKey(null); }} className="text-slate-400 hover:text-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-2 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">{fillLine(activeRow)}</p>
            {activeOrders.length > 0 ? (
                <ul className="mt-4 space-y-2">
                    {activeOrders.map((o) => (
                        <li key={o.id}>
                            <button type="button" onClick={() => setActiveOrderId(o.id)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-slate-300 hover:bg-slate-50">
                                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{initialsOf(o.guest_name)}</span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-semibold text-slate-900">{o.guest_name || 'Guest'}</span>
                                    <span className="block truncate text-xs text-slate-500">{o.item_name}{' · '}{partyLabel(o)}</span>
                                </span>
                                {/* The provider's TAKE leads — a gross figure here reads
                                    as their money and isn't. The guest total is the muted
                                    second line, so both are present and unambiguous. */}
                                <span className="flex-none text-right">
                                    <span className="block text-sm font-semibold text-slate-900">{money(providerTake(o).youGet)}</span>
                                    <span className="block text-[11px] text-slate-400">you get · {money(o.price || 0)} paid</span>
                                </span>
                                <ChevronRight className="h-4 w-4 flex-none text-slate-400" aria-hidden />
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="mt-4">
                    <p className="text-sm text-slate-500">No bookings yet — this is a session you’ve added, waiting for guests.</p>
                    {activeRow.declaredId && <button type="button" disabled={busy === activeRow.declaredId} onClick={() => removeDeclared(activeRow.declaredId!)} className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-red-400 hover:text-red-600 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Remove this session</button>}
                </div>
            )}
        </div>
        )
    );

    const rail = panel === 'add' || panel === 'bulk' ? Builder : panel === 'detail' ? Detail : (
        <div className="hidden rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400 lg:block">Click a slot to add it, or a booking to see who’s coming.</div>
    );

    // A short week strip for phones, to move between days.
    const weekDays: string[] = []; for (let n = -3; n < 11; n++) { const dd = shiftDayKey(dayDate, n); if (dd >= todayIso) weekDays.push(dd); }

    return (
        <div className="mt-5">
            {loadFailed && (
                <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4">
                    <p className="font-semibold text-red-800">We couldn’t load your calendar</p>
                    <p className="mt-1 text-sm text-red-700/80">Some of it didn’t load — that’s a connection problem, not an empty diary. Anything below may be missing until you try again.</p>
                    <button type="button" onClick={reloadAll} className="mt-3 rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800">Try again</button>
                </div>
            )}
            {!live && (
                <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <p className="font-semibold text-amber-900">One step before guests can book you</p>
                    <p className="mt-1 text-sm text-amber-900/80">Set up payouts so we can pay you. You won’t appear to guests until this is done.</p>
                    <button type="button" disabled={busy === 'payouts'} onClick={setUpPayouts} className="mt-3 rounded-lg bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{busy === 'payouts' ? 'Starting…' : (payouts && payouts.connected ? 'Finish setting up payouts' : 'Set up payouts')}</button>
                </div>
            )}
            {hasHours === false && declaredSessions.length === 0 && (
                <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <p className="font-semibold text-amber-900">Nothing’s bookable yet</p>
                    <p className="mt-1 text-sm text-amber-900/80">Set weekly hours for a regular rhythm, or add dated sessions on the calendar for a schedule that changes — either makes you bookable.</p>
                    {editHref && <a href={editHref} className="mt-3 inline-block rounded-lg bg-amber-700 px-3 py-2 text-sm font-medium text-white">Add your weekly hours</a>}
                </div>
            )}

            {/* View toggle */}
            <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
                <button type="button" onClick={() => { setView('month'); setPanel('none'); }} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${view === 'month' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}><LayoutGrid className="h-4 w-4" />Month</button>
                <button type="button" onClick={() => setView('day')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${view === 'day' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}><CalendarDays className="h-4 w-4" />Day</button>
            </div>

            {view === 'month' ? (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
                    <div>
                        <SlotCalendar shapeByDate={shapeByDate} todayIso={todayIso} selected={selected} onDayClick={onMonthDayClick} />
                        <p className="mt-2 text-xs text-slate-400">Click a day to open it. Shift-click several to add sessions to them all.</p>
                        {notice ? <p className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">{notice}</p> : null}
                        {error ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
                    </div>
                    <div ref={railRef} className={panel === 'bulk' ? '' : 'hidden lg:block'}>{panel === 'bulk' ? Builder : rail}</div>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
                    <div>
                        {/* Day header */}
                        <div className="mb-3 flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                                <button type="button" onClick={() => setDayDate((d) => shiftDayKey(d, -1))} disabled={dayDate <= todayIso} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:border-slate-400 disabled:opacity-40" aria-label="Previous day"><ChevronLeft className="h-4 w-4" /></button>
                                <span className="min-w-[9rem] text-center text-sm font-bold text-slate-900">{dateLabel(dayDate)}</span>
                                <button type="button" onClick={() => setDayDate((d) => shiftDayKey(d, 1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:border-slate-400" aria-label="Next day"><ChevronRight className="h-4 w-4" /></button>
                            </div>
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={() => addAt('')} className="rounded-lg bg-violet-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-800" title="A dated class or one-off on top of your weekly hours">+ One-off / class</button>
                                {/* Day off must never be a way to hide paid guests: a day that
                                    already has bookings can't be closed until they're cancelled or
                                    refunded. Taking the day off only stops NEW bookings; it does
                                    not cancel anyone, so a bookable-day-with-guests is disabled and
                                    says why. */}
                                <button
                                    type="button"
                                    disabled={busy === 'block' || (!dayData.dayOff && dayData.booked > 0)}
                                    onClick={() => toggleDayOff(dayDate, !dayData.dayOff)}
                                    title={!dayData.dayOff && dayData.booked > 0 ? 'You have bookings on this day. Cancel or refund them first — taking the day off only stops new bookings, it doesn’t cancel anyone.' : (dayData.dayOff ? 'Let guests book this day again' : 'Stop new bookings on this day')}
                                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${dayData.dayOff ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'border border-slate-300 text-slate-700 hover:border-slate-500'}`}
                                >{dayData.dayOff ? 'Reopen day' : 'Day off'}</button>
                            </div>
                        </div>
                        {!dayData.dayOff && dayData.booked > 0 && (
                            <p className="mb-3 text-xs text-slate-500">This day has {dayData.booked} booking{dayData.booked === 1 ? '' : 's'}. To take the day off, cancel or refund {dayData.booked === 1 ? 'it' : 'them'} first — a day off only stops new bookings, it never cancels a guest.</p>
                        )}
                        {/* The day's read at a glance — an open day says "N open",
                            never mistaken for an empty one. */}
                        <div className="mb-3 flex items-center gap-2 text-sm">
                            <span className="font-semibold text-slate-700">{daySummary}</span>
                            {openCount > 0 && <span className="text-slate-400">· your weekly hours are already bookable; the button adds a class or one-off on top</span>}
                        </div>

                        {/* Phone week strip */}
                        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
                            {weekDays.map((dd) => {
                                const sh = shapeByDate[dd]; const on = dd === dayDate;
                                return (
                                    <button key={dd} type="button" onClick={() => { setDayDate(dd); setPanel('none'); setActiveKey(null); }} className={`flex flex-none flex-col items-center rounded-xl border px-2.5 py-1.5 ${on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600'}`}>
                                        <span className="text-[10px] font-semibold uppercase">{new Date(dd + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                                        <span className="text-sm font-bold">{Number(dd.slice(8, 10))}</span>
                                        <span className="mt-0.5 flex gap-0.5">{(sh?.ticks || []).slice(0, 4).map((t, j) => <span key={j} className={`h-1 w-1 rounded-full ${t === 'block' ? 'bg-slate-300' : t.startsWith('declared') ? 'bg-violet-400' : t === 'free' ? (on ? 'bg-white/40' : 'bg-slate-200') : 'bg-emerald-400'}`} />)}</span>
                                    </button>
                                );
                            })}
                        </div>

                        <SlotDayView date={dayDate} data={dayData} freeShared={freeShared} todayIso={todayIso} nowMin={nowMin} activeTime={activeRow ? activeRow.time : null} onOpenRow={openRow} onAddAt={addAt} onRemoveBand={(id) => removePartialBlock(id)} />

                        {/* Part-day block by range */}
                        {!dayData.dayOff && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Block part of the day</span>
                                <input type="time" value={pbStart} onChange={(e) => setPbStart(e.target.value)} aria-label="From" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                                <span className="text-slate-400">–</span>
                                <input type="time" value={pbEnd} onChange={(e) => setPbEnd(e.target.value)} aria-label="Until" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                                <button type="button" disabled={!pbStart || !pbEnd || busy === 'pblock'} onClick={() => addPartialBlock(dayDate, pbStart, pbEnd)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">Block</button>
                            </div>
                        )}
                        {notice ? <p className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">{notice}</p> : null}
                        {error ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
                    </div>
                    <div ref={railRef} className={panel === 'none' ? 'hidden lg:block' : ''}>{rail}</div>
                </div>
            )}
        </div>
    );
}

function minutesToHHMM(min: number): string { const m = Math.max(0, Math.min(24 * 60, min)); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
