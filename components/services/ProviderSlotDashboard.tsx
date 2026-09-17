'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Phone, Mail, CalendarPlus, Clock, Trash2, X, ChevronRight } from 'lucide-react';
import { dateLabel, timeLabel } from '@/components/marketplace/present';
import { londonDayKey } from '@/lib/dayKey';
import SlotCalendar, { type DayChip } from '@/components/services/SlotCalendar';
import { OptionPills, Stepper, SESSION_LENGTH_OPTIONS, minutesLabel } from '@/components/services/editorControls';

// A slot provider's home — a CALENDAR, the thing they open to see their week and
// shape it. Three columns on desktop: the month grid in the centre, a left rail
// with what's coming up and the add-sessions builder, and a right rail that fills
// in when a session is picked (its bookings, the guest, the actions). On a phone
// the calendar comes first and the rails fall below it as sections. There is
// nothing to confirm — a slot is booked and paid instantly — so the only actions
// are to add or block time, and to cancel a booking (refunding the guest).

interface Order {
    id: string; status: string; service_date: string; service_time: string | null; shape: string;
    price: number; quantity: number | null; attendees: number | null; item_name: string | null; item_unit: string | null;
    guest_name: string | null; guest_phone: string | null; guest_email: string | null;
    fulfilment?: string | null; service_address?: string | null;
}
interface SlotSession {
    date: string; time: string;
    capacity: number; seats_taken: number; seats_left: number;
    private: boolean; closed: boolean;
    sold: { item_name: string; unit: string; seats: number }[];
}
interface DeclaredSession { id: string; date: string; time: string; capacity: number; seats_taken: number; title: string | null }
// One upcoming session in the rail — a booked time or a declared empty one.
interface UpSession { date: string; time: string; title: string | null; private: boolean; capacity: number; seats_taken: number; seats_left: number; declaredId: string | null }
interface DraftSession { time: string; duration: number; capacity: number; title: string }

const keyOf = (date: string, time: string) => date + ' ' + String(time).slice(0, 5);
const isTime = (t: string) => /^\d{2}:\d{2}$/.test(t);
function daysBetween(a: string, b: string): string[] {
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const out: string[] = []; let d = new Date(lo + 'T00:00:00Z'); const end = new Date(hi + 'T00:00:00Z');
    for (let g = 0; g < 400 && d <= end; g++) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
    return out;
}
const isNarrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;

export default function ProviderSlotDashboard({ providerId, editHref }: { providerId: string; editHref?: string }) {
    const [payouts, setPayouts] = useState<null | { connected: boolean; payouts_enabled: boolean }>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [sessions, setSessions] = useState<SlotSession[]>([]);
    const [blocks, setBlocks] = useState<string[]>([]);
    const [availability, setAvailability] = useState<Array<{ day_of_week: number }>>([]);
    const [hasHours, setHasHours] = useState<boolean | null>(null);
    const [partialBlocks, setPartialBlocks] = useState<Array<{ id: string; date: string; start: string; end: string }>>([]);
    const [declaredSessions, setDeclaredSessions] = useState<DeclaredSession[]>([]);
    const [slotDefaults, setSlotDefaults] = useState<{ duration: number; capacity: number }>({ duration: 60, capacity: 1 });
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    // Selection (the days the builder/block act on) and the active session (the
    // one the right rail details). Two separate interactions: click a day to
    // schedule, click a session in the rail to see its bookings.
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [anchor, setAnchor] = useState<string | null>(null);
    const [activeKey, setActiveKey] = useState<string | null>(null);

    // The add-sessions builder's draft and the list built up before committing.
    const [dTime, setDTime] = useState('');
    const [dDur, setDDur] = useState(60);
    const [dCap, setDCap] = useState(1);
    const [dTitle, setDTitle] = useState('');
    const [pending, setPending] = useState<DraftSession[]>([]);
    const [pbStart, setPbStart] = useState('');
    const [pbEnd, setPbEnd] = useState('');

    const selectionRef = useRef<HTMLDivElement | null>(null);
    const detailRef = useRef<HTMLDivElement | null>(null);

    const loadPayouts = useCallback(async () => {
        try { const r = await fetch('/api/services/connect?provider=' + encodeURIComponent(providerId)); const d = await r.json(); setPayouts({ connected: !!(d && d.connected), payouts_enabled: !!(d && d.payouts_enabled) }); } catch { /* */ }
    }, [providerId]);
    const loadOrders = useCallback(async () => {
        try { const r = await fetch('/api/services/orders?provider=' + encodeURIComponent(providerId)); const d = await r.json(); setOrders(((d && d.orders) || []).filter((o: Order) => o.shape === 'slot')); } catch { /* */ }
    }, [providerId]);
    const loadSchedule = useCallback(async () => {
        try {
            const r = await fetch('/api/services/slots/schedule?provider=' + encodeURIComponent(providerId)); const d = await r.json();
            if (d && d.ok) {
                setBlocks(d.blocks || []); setAvailability(d.availability || []); setHasHours((d.availability || []).length > 0);
                setDeclaredSessions(d.declaredSessions || []);
                const dur = Number(d.slot_length_minutes) || 60, cap = Number(d.slot_capacity) || 1;
                setSlotDefaults({ duration: dur, capacity: cap });
                setDDur((v) => v === 60 && dur !== 60 ? dur : v); setDCap((v) => v === 1 && cap !== 1 ? cap : v);
            }
        } catch { /* */ }
    }, [providerId]);
    const loadSessions = useCallback(async () => {
        try { const r = await fetch('/api/services/slots/sessions?provider=' + encodeURIComponent(providerId)); const d = await r.json(); if (d && d.ok) setSessions(d.sessions || []); } catch { /* */ }
    }, [providerId]);
    const loadPartialBlocks = useCallback(async () => {
        try { const r = await fetch('/api/services/slots/blocks?provider=' + encodeURIComponent(providerId)); const d = await r.json(); if (d && d.ok) setPartialBlocks(d.blocks || []); } catch { /* */ }
    }, [providerId]);

    useEffect(() => { loadPayouts(); loadOrders(); loadSchedule(); loadSessions(); loadPartialBlocks(); }, [loadPayouts, loadOrders, loadSchedule, loadSessions, loadPartialBlocks]);

    // On a phone the rails are sections below the calendar; bring the relevant one
    // into view when it becomes active, so a tap feels like it did something.
    useEffect(() => { if (selected.size > 0 && isNarrow()) selectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [selected]);
    useEffect(() => { if (activeKey && isNarrow()) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [activeKey]);

    async function setUpPayouts() {
        setBusy('payouts'); setError(null);
        try { const r = await fetch('/api/services/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId }) }); const d = await r.json(); if (d && d.ok && d.url) { window.location.href = d.url; return; } setError((d && d.error) || 'Could not start payout setup.'); } catch { setError('Could not start payout setup.'); }
        setBusy(null);
    }
    async function refund(orderId: string) {
        if (typeof window !== 'undefined' && !window.confirm('Cancel this booking and refund the guest in full? This can’t be undone.')) return;
        setBusy(orderId); setError(null);
        try { const r = await fetch('/api/services/orders/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, decision: 'refund' }) }); const d = await r.json(); if (!d || !d.ok) setError((d && d.error) || 'Could not do that.'); await Promise.all([loadOrders(), loadSessions()]); } catch { setError('Could not do that.'); }
        setBusy(null);
    }
    async function toggleBlock(date: string, on: boolean) {
        setBusy('block'); setError(null); setNotice(null);
        const next = on ? Array.from(new Set([...blocks, date])) : blocks.filter((b) => b !== date);
        try { const r = await fetch('/api/services/slots/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, blocks: next }) }); const d = await r.json(); if (d && d.ok) setBlocks(next); else setError((d && d.error) || 'Could not save that.'); } catch { setError('Could not save that.'); }
        setBusy(null);
    }
    async function blockDays(dates: string[], on: boolean) {
        setBusy('block'); setError(null); setNotice(null);
        const next = on ? Array.from(new Set([...blocks, ...dates])) : blocks.filter((b) => !dates.includes(b));
        try { const r = await fetch('/api/services/slots/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, blocks: next }) }); const d = await r.json(); if (d && d.ok) { setBlocks(next); setNotice(`${on ? 'Blocked' : 'Reopened'} ${dates.length} day${dates.length === 1 ? '' : 's'}.`); } else setError((d && d.error) || 'Could not save that.'); } catch { setError('Could not save that.'); }
        setBusy(null);
    }
    async function addPartialBlock(date: string, start: string, end: string) {
        if (!date || !start || !end) return;
        setBusy('pblock'); setError(null);
        try { const r = await fetch('/api/services/slots/blocks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, date, start, end }) }); const d = await r.json(); if (d && d.ok) await loadPartialBlocks(); else setError((d && d.error) || 'Could not block that time.'); } catch { setError('Could not block that time.'); }
        setBusy(null);
    }
    async function removePartialBlock(id: string) {
        setBusy(id); setError(null);
        try { const r = await fetch('/api/services/slots/blocks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, id }) }); const d = await r.json(); if (d && d.ok) await loadPartialBlocks(); else setError((d && d.error) || 'Could not remove that block.'); } catch { setError('Could not remove that block.'); }
        setBusy(null);
    }
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
        } catch { setError('Could not add the sessions.'); }
        setBusy(null);
    }
    async function removeDeclared(id: string) {
        setBusy(id); setError(null); setNotice(null);
        try { const r = await fetch('/api/services/slots/sessions/declare', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, id }) }); const d = await r.json(); if (d && d.ok) { setActiveKey(null); await loadSchedule(); } else setError((d && d.error) || 'Could not remove that session.'); } catch { setError('Could not remove that session.'); }
        setBusy(null);
    }

    // ---- selection + derived data --------------------------------------------
    const todayIso = londonDayKey();
    const toggleDay = (date: string, shift: boolean) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (shift && anchor) { for (const dd of daysBetween(anchor, date)) if (dd >= todayIso) next.add(dd); }
            else if (next.has(date)) next.delete(date); else next.add(date);
            return next;
        });
        if (!shift) setAnchor(date);
    };
    const clearSelection = () => { setSelected(new Set()); setAnchor(null); setPending([]); setDTime(''); setDTitle(''); setPbStart(''); setPbEnd(''); };
    const selArr = Array.from(selected).sort();
    const oneDay = selArr.length === 1 ? selArr[0] : null;

    const confirmed = orders.filter((o) => o.status === 'confirmed' && o.service_date >= todayIso);
    const ordersByKey: Record<string, Order[]> = {};
    for (const o of confirmed) (ordersByKey[keyOf(o.service_date, o.service_time || '')] = ordersByKey[keyOf(o.service_date, o.service_time || '')] || []).push(o);
    const fillByKey: Record<string, SlotSession> = {};
    for (const s of sessions) fillByKey[keyOf(s.date, s.time)] = s;

    // Upcoming sessions in the rail: booked times (with their fill) plus declared
    // empty ones. Sorted; future only.
    const bookedUp: UpSession[] = sessions.filter((s) => s.date >= todayIso)
        .map((s) => ({ date: s.date, time: s.time, title: null, private: s.private, capacity: s.capacity, seats_taken: s.seats_taken, seats_left: s.seats_left, declaredId: null }));
    const bookedKeys = new Set(bookedUp.map((s) => keyOf(s.date, s.time)));
    const declaredUp: UpSession[] = declaredSessions.filter((s) => s.seats_taken === 0 && s.date >= todayIso && !bookedKeys.has(keyOf(s.date, s.time)))
        .map((s) => ({ date: s.date, time: s.time, title: s.title, private: false, capacity: s.capacity, seats_taken: 0, seats_left: s.capacity, declaredId: s.id }));
    const upcoming = [...bookedUp, ...declaredUp].sort((a, b) => keyOf(a.date, a.time).localeCompare(keyOf(b.date, b.time)));
    const activeSession = activeKey ? upcoming.find((s) => keyOf(s.date, s.time) === activeKey) || null : null;
    const activeOrders = activeKey ? (ordersByKey[activeKey] || []) : [];

    // Per-day cell chips: booked times (emerald) + declared empty (violet).
    const chipsByDate: Record<string, DayChip[]> = {};
    for (const s of bookedUp) (chipsByDate[s.date] = chipsByDate[s.date] || []).push({ time: s.time, kind: 'booked' });
    for (const s of declaredUp) (chipsByDate[s.date] = chipsByDate[s.date] || []).push({ time: s.time, kind: 'declared' });
    for (const k of Object.keys(chipsByDate)) chipsByDate[k].sort((a, b) => a.time.localeCompare(b.time));

    const openWeekdays = new Set(availability.map((a) => a.day_of_week));
    const blockedDates = new Set(blocks);
    const partialByDate: Record<string, { id: string; start: string; end: string }[]> = {};
    for (const b of partialBlocks) (partialByDate[b.date] = partialByDate[b.date] || []).push({ id: b.id, start: b.start, end: b.end });
    const selPartials = oneDay ? (partialByDate[oneDay] || []) : [];
    const selBlocked = oneDay ? blockedDates.has(oneDay) : false;

    const live = payouts && payouts.payouts_enabled;

    // ---- builder helpers ------------------------------------------------------
    const draftValid = isTime(dTime);
    const addDraft = () => { if (!draftValid) return; setPending((p) => [...p, { time: dTime, duration: dDur, capacity: dCap, title: dTitle.trim() }]); setDTime(''); setDTitle(''); };
    const toCommit: DraftSession[] = [...pending, ...(draftValid ? [{ time: dTime, duration: dDur, capacity: dCap, title: dTitle.trim() }] : [])];
    const commit = () => { if (!toCommit.length || !selArr.length) return; addSessions(selArr, toCommit); setPending([]); setDTime(''); setDTitle(''); };
    const lengthOpts = Array.from(new Set([...SESSION_LENGTH_OPTIONS, slotDefaults.duration || 60])).sort((a, b) => a - b);

    const fillLine = (s: UpSession) => s.private
        ? 'Private hire'
        : `${s.seats_taken} of ${s.capacity} booked${s.seats_left > 0 ? ` · ${s.seats_left} left` : ' · full'}`;

    return (
        <div className="mt-5">
            {!live && (
                <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <p className="font-semibold text-amber-900">One step before guests can book you</p>
                    <p className="mt-1 text-sm text-amber-900/80">Set up payouts so we can pay you. You won’t appear to guests until this is done.</p>
                    <button type="button" disabled={busy === 'payouts'} onClick={setUpPayouts} className="mt-3 rounded-lg bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                        {busy === 'payouts' ? 'Starting…' : (payouts && payouts.connected ? 'Finish setting up payouts' : 'Set up payouts')}
                    </button>
                </div>
            )}
            {hasHours === false && declaredSessions.length === 0 && (
                <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <p className="font-semibold text-amber-900">Nothing’s bookable yet</p>
                    <p className="mt-1 text-sm text-amber-900/80">Set weekly hours for a regular rhythm, or add dated sessions on the calendar for a schedule that changes — either makes you bookable.</p>
                    {editHref && <a href={editHref} className="mt-3 inline-block rounded-lg bg-amber-700 px-3 py-2 text-sm font-medium text-white">Add your weekly hours</a>}
                </div>
            )}

            <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)_20rem]">
                {/* LEFT — the builder (when days are picked) + what's coming up. */}
                <div className="order-2 space-y-5 lg:order-1">
                    <div ref={selectionRef}>
                        {selArr.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                                <CalendarPlus className="mb-1.5 h-5 w-5 text-slate-400" aria-hidden />
                                Pick a day on the calendar to add a session or block time. Shift-click for a run of days.
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-bold text-slate-900">{oneDay ? dateLabel(oneDay) : `${selArr.length} days selected`}</p>
                                    <button type="button" onClick={clearSelection} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700"><X className="h-3.5 w-3.5" />Clear</button>
                                </div>
                                {!oneDay && <p className="mt-1 text-xs text-slate-500">{selArr.map((d) => dateLabel(d)).join(' · ')}</p>}

                                <div className="mt-3 flex items-center gap-2"><CalendarPlus className="h-4 w-4 text-violet-700" aria-hidden /><p className="text-sm font-semibold text-slate-900">Add sessions</p></div>
                                <div className="mt-2 space-y-3">
                                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Time
                                        <input type="time" value={dTime} onChange={(e) => setDTime(e.target.value)} className="mt-1 block rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
                                    </label>
                                    <div><span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Length</span>
                                        <div className="mt-1"><OptionPills options={lengthOpts.map((m) => ({ value: String(m), label: minutesLabel(m) }))} value={String(dDur)} onChange={(v) => setDDur(Number(v))} /></div></div>
                                    <div><span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Capacity</span>
                                        <div className="mt-1"><Stepper value={dCap} onChange={setDCap} min={1} max={60} /></div></div>
                                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Name (optional)
                                        <input type="text" value={dTitle} onChange={(e) => setDTitle(e.target.value)} placeholder="e.g. Sunset session" className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-900" />
                                    </label>
                                    <button type="button" onClick={addDraft} disabled={!draftValid} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-500 disabled:opacity-40">+ Add another</button>
                                </div>
                                {toCommit.length > 0 && (
                                    <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                                        {toCommit.map((s, i) => (
                                            <li key={i} className="flex items-center gap-2 rounded-xl bg-violet-50 px-2.5 py-1.5 text-sm ring-1 ring-violet-200">
                                                <Clock className="h-3.5 w-3.5 flex-none text-violet-700" aria-hidden />
                                                <span className="font-semibold text-slate-900">{timeLabel(s.time + ':00')}</span>
                                                <span className="text-xs text-slate-500">{minutesLabel(s.duration)} · up to {s.capacity}{s.title ? ` · ${s.title}` : ''}</span>
                                                {i < pending.length ? <button type="button" onClick={() => setPending((p) => p.filter((_, j) => j !== i))} className="ml-auto text-slate-400 hover:text-red-600" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button> : <span className="ml-auto text-[10px] font-semibold uppercase text-slate-400">draft</span>}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <button type="button" onClick={commit} disabled={!toCommit.length || busy === 'declare'} className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                                    {busy === 'declare' ? 'Adding…' : `Add ${toCommit.length || ''} session${toCommit.length === 1 ? '' : 's'}${oneDay ? '' : ` to ${selArr.length} days`}`.replace('  ', ' ')}
                                </button>

                                {/* Block */}
                                <div className="mt-4 border-t border-slate-100 pt-3">
                                    {oneDay ? (
                                        <>
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-sm text-slate-700">{selBlocked ? 'This day is off' : 'Block the whole day'}</span>
                                                <button type="button" disabled={busy === 'block'} onClick={() => toggleBlock(oneDay, !selBlocked)} className={`rounded-xl px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${selBlocked ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-slate-900 hover:bg-black'}`}>{selBlocked ? 'Reopen' : 'Block'}</button>
                                            </div>
                                            {!selBlocked && (
                                                <div className="mt-3">
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Block part of the day</p>
                                                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                                        <input type="time" value={pbStart} onChange={(e) => setPbStart(e.target.value)} aria-label="From" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                                                        <span className="text-slate-400">–</span>
                                                        <input type="time" value={pbEnd} onChange={(e) => setPbEnd(e.target.value)} aria-label="Until" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                                                        <button type="button" disabled={!pbStart || !pbEnd || busy === 'pblock'} onClick={() => { addPartialBlock(oneDay, pbStart, pbEnd); setPbStart(''); setPbEnd(''); }} className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">Block</button>
                                                    </div>
                                                    {selPartials.length > 0 && (
                                                        <ul className="mt-2 flex flex-wrap gap-1.5">
                                                            {selPartials.map((b) => (
                                                                <li key={b.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{b.start}–{b.end}<button type="button" disabled={busy === b.id} onClick={() => removePartialBlock(b.id)} aria-label="Remove" className="text-slate-400 hover:text-red-600">×</button></li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm text-slate-700">Take all {selArr.length} days off</span>
                                            <button type="button" disabled={busy === 'block'} onClick={() => blockDays(selArr, true)} className="rounded-xl bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">Block</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Upcoming */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-bold text-slate-900">Upcoming</p>
                        {upcoming.length === 0 ? (
                            <p className="mt-2 text-sm text-slate-400">Nothing coming up yet.</p>
                        ) : (
                            <ul className="mt-2 divide-y divide-slate-100">
                                {upcoming.slice(0, 40).map((s) => {
                                    const k = keyOf(s.date, s.time);
                                    const isActive = k === activeKey;
                                    return (
                                        <li key={k}>
                                            <button type="button" onClick={() => setActiveKey(k)} className={`flex w-full items-center gap-2 py-2 text-left ${isActive ? '' : ''}`}>
                                                <span className="flex w-14 flex-none flex-col leading-tight">
                                                    <span className="text-xs font-semibold text-slate-500">{dateLabel(s.date).replace(/,.*$/, '')}</span>
                                                    <span className="text-sm font-bold text-slate-900">{timeLabel(s.time + ':00')}</span>
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm text-slate-800">{s.title || (s.declaredId ? 'Session' : (s.private ? 'Private booking' : 'Shared session'))}</span>
                                                    <span className={`block truncate text-xs ${s.declaredId ? 'text-violet-600' : 'text-slate-500'}`}>{s.declaredId ? `${s.capacity} space${s.capacity === 1 ? '' : 's'} · none booked yet` : fillLine(s)}</span>
                                                </span>
                                                <ChevronRight className={`h-4 w-4 flex-none ${isActive ? 'text-slate-700' : 'text-slate-300'}`} aria-hidden />
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>

                {/* CENTRE — the calendar. */}
                <div className="order-1 lg:order-2">
                    <SlotCalendar openWeekdays={openWeekdays} blockedDates={blockedDates} partialByDate={partialByDate} chipsByDate={chipsByDate} todayIso={todayIso} selected={selected} onToggleDay={toggleDay} />
                    {notice ? <p className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">{notice}</p> : null}
                    {error ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
                </div>

                {/* RIGHT — the picked session's bookings and actions. */}
                <div ref={detailRef} className={`order-3 lg:order-3 ${activeSession ? '' : 'hidden lg:block'}`}>
                    {activeSession ? (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <p className="text-sm font-bold text-slate-900">{dateLabel(activeSession.date)}</p>
                                    <p className="text-sm text-slate-500">{timeLabel(activeSession.time + ':00')}{activeSession.title ? ` · ${activeSession.title}` : ''}</p>
                                </div>
                                <button type="button" onClick={() => setActiveKey(null)} className="text-slate-400 hover:text-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
                            </div>
                            <p className="mt-2 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                                {activeSession.declaredId && activeOrders.length === 0 ? `${activeSession.capacity} spaces · none booked` : fillLine(activeSession)}
                            </p>

                            {activeOrders.length > 0 ? (
                                <ul className="mt-4 space-y-3">
                                    {activeOrders.map((o) => (
                                        <li key={o.id} className="rounded-xl border border-slate-200 p-3">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-semibold text-slate-900">{o.guest_name || 'Guest'}</span>
                                                <span className="text-sm font-semibold text-slate-900">£{o.price.toFixed(2)}</span>
                                            </div>
                                            <p className="mt-0.5 text-xs text-slate-500">
                                                {o.item_name}{o.quantity && o.quantity > 1 ? ` · ${o.quantity} people` : ''}{o.attendees && o.attendees > 1 ? ` · party of ${o.attendees}` : ''}
                                            </p>
                                            {o.fulfilment === 'delivery' && o.service_address ? (
                                                <p className="mt-1 flex items-start gap-1 text-xs text-slate-600"><MapPin className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400" aria-hidden />Comes to {o.service_address}</p>
                                            ) : null}
                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                                {o.guest_phone ? <a href={'tel:' + o.guest_phone} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-slate-400"><Phone className="h-3.5 w-3.5" />Call</a> : null}
                                                {o.guest_email ? <a href={'mailto:' + o.guest_email} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-slate-400"><Mail className="h-3.5 w-3.5" />Email</a> : null}
                                                <button type="button" disabled={busy === o.id} onClick={() => refund(o.id)} className="ml-auto text-xs font-medium text-slate-500 underline hover:text-red-600 disabled:opacity-60">{busy === o.id ? 'Refunding…' : 'Cancel & refund'}</button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div className="mt-4">
                                    <p className="text-sm text-slate-500">No bookings yet — this is a session you’ve added, waiting for guests.</p>
                                    {activeSession.declaredId && (
                                        <button type="button" disabled={busy === activeSession.declaredId} onClick={() => removeDeclared(activeSession.declaredId!)} className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:border-red-400 hover:text-red-600 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Remove this session</button>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
                            Pick a session from Upcoming to see who’s coming and manage it.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
