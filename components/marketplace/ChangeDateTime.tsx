'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import { Loader2, ChevronRight, X, Check } from 'lucide-react';

// "Change date or time" — ONE sheet for every shape, adapting to the engine:
//
//   - SLOT: a calendar of the provider's sessions; picking a day reveals that
//     day's times, and moving is a no-money session repoint. Past the booking's
//     own cancellation cutoff the feed comes back `locked` and nothing is offered.
//   - REQUEST (made_to_order / comes_to_you): there is no time, only a delivery /
//     collection / service DATE. The calendar offers the dates the booking flow
//     would — a made-to-order lead time and horizon; a comes-to-you date nobody
//     else holds that provider for; inside a cottage stay when the order sits on
//     one — and moving costs nothing. Past the free-cancellation window it is
//     locked, the same cutoff the refund uses.

interface Session {
    date: string; time: string; capacity: number; seatsLeft: number;
    private: boolean; available: boolean; reason: string | null;
}
interface SlotFeed {
    business: string | null; itemName: string | null; familySeats: number; familyPrivate: boolean;
    current: { date: string; time: string }; horizonDays: number; locked?: boolean; sessions: Session[];
}
interface DateFeed {
    shape: string; locked: boolean; deadlineISO: string | null;
    current: { date: string; time: string | null }; minKey: string; maxKey: string; horizonDays: number;
    takenDates: string[]; exclusive: boolean;
    offeredTimes: string[];
    // Comes-to-you: the open start times per date, from the provider's opening
    // hours. When present, a date is offerable only if it has times, and the
    // picked date's times are the choices.
    timesByDate?: Record<string, string[]>;
}

function keyOf(d: Date): string {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dateFromKey(key: string): Date { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function dayLabel(key: string): string {
    try { return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' }).format(new Date(key + 'T12:00:00Z')); }
    catch { return key; }
}
function whenLabel(date: string, time?: string): string {
    try {
        const d = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(date + 'T12:00:00Z'));
        return time ? d + ' at ' + time : d;
    } catch { return time ? date + ' at ' + time : date; }
}
function reasonLabel(reason: string | null, session: Session): string {
    switch (reason) {
        case 'full': return 'Full';
        case 'cutoff': return 'Too close';
        case 'mode': return session.private ? 'Private' : 'Shared';
        default: return 'Unavailable';
    }
}

function CalendarIcon() {
    return (
        <svg className="h-4 w-4 flex-none text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
        </svg>
    );
}

export default function ChangeDateTime({ orderId, shape, className }: { orderId: string; shape?: string | null; className?: string }) {
    const isRequest = shape === 'made_to_order' || shape === 'comes_to_you';
    const endpoint = isRequest ? '/api/services/order/change-date' : '/api/services/slots/move';

    const [open, setOpen] = useState(false);
    const [slot, setSlot] = useState<SlotFeed | null>(null);
    const [dateFeed, setDateFeed] = useState<DateFeed | null>(null);
    const [loadErr, setLoadErr] = useState<string | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [pickedTime, setPickedTime] = useState<{ date: string; time: string } | null>(null);
    const [pickedDate, setPickedDate] = useState<string | null>(null);
    const [reqTime, setReqTime] = useState<string | null>(null);   // request-shape chosen time
    const [shownDate, setShownDate] = useState<Date | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        setLoadErr(null); setSlot(null); setDateFeed(null); setSelectedKey(null); setPickedTime(null); setPickedDate(null); setReqTime(null); setShownDate(null); setError(null);
        try {
            const r = await fetch(endpoint + '?orderId=' + encodeURIComponent(orderId));
            const d = await r.json();
            if (!r.ok || !d.ok) { setLoadErr(d && d.error ? d.error : 'Could not load this.'); return; }
            if (isRequest) { setDateFeed(d as DateFeed); setReqTime((d as DateFeed).current?.time || null); } else setSlot(d as SlotFeed);
        } catch { setLoadErr('Could not load this.'); }
    }
    function openModal() { setOpen(true); load(); }
    function closeModal() { setOpen(false); }

    async function proceed() {
        setBusy(true); setError(null);
        try {
            const body = isRequest
                ? { orderId, date: pickedDate || (dateFeed ? dateFeed.current.date : undefined), time: reqTime || undefined }
                : { orderId, sessionDate: pickedTime?.date, sessionTime: pickedTime?.time };
            const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const d = await r.json();
            if (r.ok && d && d.ok) { window.location.reload(); return; }
            setError((d && d.error) || 'Could not change the date.');
        } catch { setError('Could not change the date.'); }
        setBusy(false);
    }

    // ---- slot-only derived (unchanged behaviour) -------------------------------
    const other = slot ? slot.sessions.filter((s) => s.reason !== 'current') : [];
    const openDayKeys = new Set(other.filter((s) => s.available).map((s) => s.date));
    const slotHorizon = slot ? (slot.horizonDays || 120) : 120;

    // ---- request-only derived --------------------------------------------------
    const reqHorizon = dateFeed ? (dateFeed.horizonDays || 90) : 90;
    const takenSet = new Set(dateFeed ? dateFeed.takenDates : []);
    // Comes-to-you: per-date opening-hours times. When present, a date is open
    // only if it has times, and the picked date's times are the choices.
    const timesByDate = dateFeed && dateFeed.timesByDate ? dateFeed.timesByDate : null;
    const hasHourTimes = !!timesByDate && Object.keys(timesByDate).length > 0;

    const minDate = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
    const maxDate = useMemo(() => new Date(Date.now() + (isRequest ? reqHorizon : slotHorizon) * 86400000), [isRequest, reqHorizon, slotHorizon]);
    const currentKey = isRequest ? (dateFeed ? dateFeed.current.date : '') : (slot ? slot.current.date : '');
    const currentDate = useMemo(() => currentKey ? dateFromKey(currentKey) : new Date(), [currentKey]);

    // The days a date/time can move to, for greying the rest.
    const requestOpen = (key: string) => {
        if (!dateFeed) return false;
        if (key < dateFeed.minKey || key > dateFeed.maxKey) return false;
        if (takenSet.has(key)) return false;
        // With opening hours, a date is offerable only if it has open times.
        if (hasHourTimes) return !!timesByDate![key];
        return true;
    };
    const disabledDates: Date[] = [];
    const locked = isRequest ? (dateFeed ? dateFeed.locked : false) : (slot ? !!slot.locked : false);
    if ((slot || dateFeed) && !locked) {
        for (let t = minDate.getTime(); t <= maxDate.getTime(); t += 86400000) {
            const d = new Date(t); const k = keyOf(d);
            const openHere = isRequest ? requestOpen(k) : openDayKeys.has(k);
            if (!openHere) disabledDates.push(d);
        }
    }
    const renderDay = (date: Date) => {
        const k = keyOf(date);
        const openHere = isRequest ? requestOpen(k) : openDayKeys.has(k);
        if (openHere) return <span>{date.getDate()}</span>;
        return <span className="line-through decoration-2 decoration-slate-400">{date.getDate()}<span className="sr-only"> unavailable</span></span>;
    };

    const dayTimes = selectedKey && slot
        ? other.filter((s) => s.date === selectedKey).sort((a, b) => a.time.localeCompare(b.time))
        : [];

    // Slot-only month hints: which MONTHS hold an open day, so an empty visible
    // month can say where to look instead of a wall of struck dates.
    const monthKeyOf = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const monthNameOf = (mk: string) => {
        try { return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(mk + '-01T12:00:00Z')); }
        catch { return mk; }
    };
    const openMonthKeys = new Set(Array.from(openDayKeys).map((k) => k.slice(0, 7)));
    const shown = shownDate || currentDate;
    const shownMonthEmpty = !isRequest && !!slot && openDayKeys.size > 0 && !openMonthKeys.has(monthKeyOf(shown));
    const currentInShownMonth = !isRequest && !!slot && monthKeyOf(currentDate) === monthKeyOf(shown);
    const openMonthsList = Array.from(openMonthKeys).sort().map(monthNameOf);
    const availabilityHint = openMonthsList.length === 0 ? ''
        : openMonthsList.length === 1
            ? 'There’s room in ' + openMonthsList[0] + ' — use the arrows above to go there.'
            : 'There’s room in ' + openMonthsList.slice(0, -1).join(', ') + ' and ' + openMonthsList[openMonthsList.length - 1] + ' — use the arrows above to find it.';

    const anyOpen = isRequest
        ? (!!dateFeed && !locked && (function () { for (let t = minDate.getTime(); t <= maxDate.getTime(); t += 86400000) if (requestOpen(keyOf(new Date(t)))) return true; return false; })())
        : (!!slot && !locked && openDayKeys.size > 0);

    const feedReady = isRequest ? !!dateFeed : !!slot;
    const effectiveReqDate = pickedDate || (dateFeed ? dateFeed.current.date : '');
    // The time choices for the picked date: the opening-hours times for that day
    // when present, else the provider's flat offered_times (legacy), else none.
    const reqTimeOptions = hasHourTimes ? (timesByDate![effectiveReqDate] || []) : (dateFeed?.offeredTimes || []);
    // Whether this shape lets the guest pick a time at all (comes-to-you with
    // hours, or a legacy provider with named offered_times). A made-to-order has
    // none, so the sheet is date-only.
    const showsReqTime = hasHourTimes || (dateFeed?.offeredTimes || []).length > 0;
    const reqChanged = !!dateFeed && ((effectiveReqDate !== dateFeed.current.date) || ((reqTime || '') !== (dateFeed.current.time || '')));
    const reqReady = !dateFeed || (reqTimeOptions.length ? !!reqTime : true);
    const currentWhen = isRequest ? whenLabel(dateFeed?.current.date || '', dateFeed?.current.time || undefined) : whenLabel(slot?.current.date || '', slot?.current.time);

    return (
        <>
            <button type="button" onClick={openModal}
                className={className || 'text-sm font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800'}>
                {className ? (
                    <><span className="flex items-center gap-3"><CalendarIcon /> Change date or time</span><ChevronRight className="h-4 w-4 flex-none text-slate-300" /></>
                ) : 'Change date or time'}
            </button>

            {open && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-0 sm:items-center sm:px-4" onClick={closeModal}>
                    <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 pt-5">
                            <h2 className="text-lg font-bold text-slate-900">{isRequest && !showsReqTime ? 'Change date' : 'Change date or time'}</h2>
                            <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">
                            {loadErr ? (
                                <p className="text-sm text-rose-600">{loadErr}</p>
                            ) : !feedReady ? (
                                <p className="text-sm text-slate-400">Loading…</p>
                            ) : (
                                <div className="space-y-4">
                                    <div className="rounded-lg bg-slate-50 p-3 text-sm">
                                        <div className="text-slate-700">Currently <span className="font-semibold text-slate-900">{currentWhen}</span>.</div>
                                    </div>

                                    {locked ? (
                                        <div className="space-y-3">
                                            <p className="text-sm text-slate-600">Changes are closed now — the free-cancellation window has passed. Message the provider if you need to change anything.</p>
                                            <a href={'/messages?o=' + orderId} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">Message the provider</a>
                                        </div>
                                    ) : !anyOpen ? (
                                        <p className="text-sm text-slate-600">There are no other {isRequest ? 'dates' : 'sessions'} open to move this booking to right now.</p>
                                    ) : (
                                        <>
                                            <div className="rdr-move relative overflow-hidden rounded-xl border border-slate-200">
                                                <Calendar
                                                    date={selectedKey ? dateFromKey(selectedKey) : undefined}
                                                    shownDate={currentDate}
                                                    onShownDateChange={(d: Date) => setShownDate(d)}
                                                    onChange={(d: Date) => {
                                                        const k = keyOf(d);
                                                        setSelectedKey(k); setError(null);
                                                        if (isRequest) {
                                                            setPickedDate(k);
                                                            // With opening hours, the times depend on the
                                                            // weekday — keep the chosen time if the new day
                                                            // offers it, else drop back to that day's own
                                                            // current time (if it is the booking's day) or
                                                            // clear so the guest picks one.
                                                            if (hasHourTimes) {
                                                                const opts = timesByDate![k] || [];
                                                                setReqTime((prev) => (prev && opts.includes(prev))
                                                                    ? prev
                                                                    : (k === dateFeed?.current.date ? (dateFeed?.current.time || null) : null));
                                                            }
                                                        } else setPickedTime(null);
                                                    }}
                                                    minDate={minDate}
                                                    maxDate={maxDate}
                                                    disabledDates={disabledDates}
                                                    color="#047857"
                                                    preventSnapRefocus
                                                    dayContentRenderer={renderDay}
                                                />
                                                {/* Slot: when the visible month has nothing to move to,
                                                    cover the struck dates with words — the month nav stays
                                                    clickable. */}
                                                {shownMonthEmpty && (
                                                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center justify-center bg-white/95 px-6 text-center" style={{ top: 50 }}>
                                                        <p className="text-sm font-semibold text-slate-700">
                                                            {currentInShownMonth
                                                                ? 'Your booking is the only session in ' + monthNameOf(monthKeyOf(shown))
                                                                : 'Nothing open in ' + monthNameOf(monthKeyOf(shown))}
                                                        </p>
                                                        <p className="mt-1 text-[13px] text-slate-500">
                                                            {currentInShownMonth ? 'There’s nothing else here to move to. ' : ''}{availabilityHint}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Slot: the chosen day's times. Request: the chosen date is the pick. */}
                                            {!isRequest && selectedKey && !shownMonthEmpty && (
                                                <div>
                                                    <div className="text-[13px] font-semibold text-slate-700">{dayLabel(selectedKey)}</div>
                                                    {dayTimes.length === 0 ? (
                                                        <p className="mt-1 text-[13px] text-slate-500">No times on this day.</p>
                                                    ) : (
                                                        <div className="mt-2 flex flex-wrap gap-2">
                                                            {dayTimes.map((s) => {
                                                                const isPicked = !!pickedTime && pickedTime.date === s.date && pickedTime.time === s.time;
                                                                if (!s.available) {
                                                                    return (
                                                                        <span key={s.time} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400" title={reasonLabel(s.reason, s)}>
                                                                            <span className="line-through">{s.time}</span>
                                                                            <span className="text-[11px] uppercase tracking-wide">· {reasonLabel(s.reason, s)}</span>
                                                                        </span>
                                                                    );
                                                                }
                                                                return (
                                                                    <button key={s.time} type="button" onClick={() => { setPickedTime({ date: s.date, time: s.time }); setError(null); }}
                                                                        className={'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition ' + (isPicked ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-700 hover:border-slate-400')}>
                                                                        {isPicked ? <Check className="h-4 w-4" /> : null}{s.time}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {isRequest && selectedKey && (
                                                <p className="text-[13px] text-slate-600">New date: <span className="font-semibold text-slate-900">{dayLabel(selectedKey)}</span></p>
                                            )}
                                            {isRequest && reqTimeOptions.length > 0 && (
                                                <div>
                                                    <div className="text-[13px] font-semibold text-slate-700">Time</div>
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {reqTimeOptions.map((t) => {
                                                            const isPicked = reqTime === t;
                                                            return (
                                                                <button key={t} type="button" onClick={() => { setReqTime(t); setError(null); }}
                                                                    className={'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition ' + (isPicked ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-700 hover:border-slate-400')}>
                                                                    {isPicked ? <Check className="h-4 w-4" /> : null}{t}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {error && <p className="text-[13px] text-rose-600">{error}</p>}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        {feedReady && !locked && anyOpen && !loadErr && (
                            <div className="border-t border-slate-100 p-4">
                                <button type="button" disabled={busy || (isRequest ? (!reqChanged || !reqReady) : !pickedTime)} onClick={proceed}
                                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    {isRequest
                                        ? (reqChanged ? 'Request ' + (reqTimeOptions.length && reqTime ? whenLabel(effectiveReqDate, reqTime) : dayLabel(effectiveReqDate)) : 'Pick a new date or time')
                                        : (pickedTime ? 'Move to ' + whenLabel(pickedTime.date, pickedTime.time) : 'Pick a new time')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
