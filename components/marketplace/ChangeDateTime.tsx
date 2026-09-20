'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import { Loader2, ChevronRight, X, Check } from 'lucide-react';

// "Change date or time" — a reservation ACTION row that opens a MODAL over the
// order page, the same shape as "Change guest count". Inside is a CALENDAR — the
// same react-date-range picker the cottage booking flow uses, with unavailable
// days greyed and struck through the same way — that opens on the booking's
// CURRENT month, so later dates are the obvious path and earlier ones are reached
// by paging back. Picking a day reveals that day's times: the ones this booking
// can move to are selectable, and times that exist but can't take it are greyed
// with a one-word reason, under a line that explains each.
//
// A day is offered only when it has at least one time this order can legitimately
// move to (right mode, room for the WHOLE family, not past that session's own
// cutoff) — decided server-side by the same rule the move RPC enforces, so a time
// offered here is one the move will accept. Payer-only; the route is the wall.

interface Session {
    date: string;            // YYYY-MM-DD
    time: string;            // HH:MM
    capacity: number;
    seatsLeft: number;
    private: boolean;
    available: boolean;
    reason: string | null;   // 'current' | 'blocked' | 'cutoff' | 'not-ready' | 'mode' | 'full'
}
interface Feed {
    business: string | null;
    itemName: string | null;
    familySeats: number;
    familyPrivate: boolean;
    current: { date: string; time: string };
    horizonDays: number;
    sessions: Session[];
}

// A YYYY-MM-DD key from a Date, in its own (local) fields — the same shape the
// cottage calendar keys its disabled days by.
function keyOf(d: Date): string {
    return d.getFullYear()
        + '-' + String(d.getMonth() + 1).padStart(2, '0')
        + '-' + String(d.getDate()).padStart(2, '0');
}
function dateFromKey(key: string): Date {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function dayLabel(key: string): string {
    try {
        return new Intl.DateTimeFormat('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London',
        }).format(new Date(key + 'T12:00:00Z'));
    } catch { return key; }
}
function whenLabel(date: string, time: string): string {
    try {
        const d = new Intl.DateTimeFormat('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London',
        }).format(new Date(date + 'T12:00:00Z'));
        return d + ' at ' + time;
    } catch { return date + ' at ' + time; }
}
function reasonLabel(reason: string | null, session: Session): string {
    switch (reason) {
        case 'full': return 'Full';
        case 'cutoff': return 'Too close';
        case 'mode': return session.private ? 'Private' : 'Shared';
        default: return 'Unavailable';
    }
}

export default function ChangeDateTime({ orderId, className }: { orderId: string; className?: string }) {
    const [open, setOpen] = useState(false);
    const [feed, setFeed] = useState<Feed | null>(null);
    const [loadErr, setLoadErr] = useState<string | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [picked, setPicked] = useState<{ date: string; time: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        setLoadErr(null); setFeed(null); setSelectedKey(null); setPicked(null); setError(null);
        try {
            const r = await fetch('/api/services/slots/move?orderId=' + encodeURIComponent(orderId));
            const d = await r.json();
            if (!r.ok || !d.ok) { setLoadErr(d && d.error ? d.error : 'Could not load this.'); return; }
            setFeed(d as Feed);
        } catch { setLoadErr('Could not load this.'); }
    }

    function openModal() { setOpen(true); load(); }
    function closeModal() { setOpen(false); }

    async function proceed() {
        if (!picked) return;
        setBusy(true); setError(null);
        try {
            const r = await fetch('/api/services/slots/move', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId, sessionDate: picked.date, sessionTime: picked.time }),
            });
            const d = await r.json();
            if (r.ok && d && d.ok) { window.location.reload(); return; }
            setError((d && d.error) || 'Could not move your booking.');
        } catch { setError('Could not move your booking.'); }
        setBusy(false);
    }

    // ---- derived, only once the feed is in --------------------------------
    // Sessions the family can actually move to, and the set of DAYS that hold at
    // least one — a day is offered only when it has an open time, exactly as the
    // cottage calendar offers only nights it can sell.
    const other = feed ? feed.sessions.filter((s) => s.reason !== 'current') : [];
    const openDayKeys = new Set(other.filter((s) => s.available).map((s) => s.date));

    // The window the calendar spans: today → today + horizon.
    const minDate = new Date(); minDate.setHours(0, 0, 0, 0);
    const maxDate = feed ? new Date(Date.now() + (feed.horizonDays || 120) * 86400000) : new Date();
    const currentDate = feed ? dateFromKey(feed.current.date) : new Date();

    // Every day in the window that ISN'T an open day is greyed/struck, the way the
    // cottage calendar greys a taken night. (Cheap: one pass over the horizon.)
    const disabledDates: Date[] = [];
    if (feed) {
        for (let t = minDate.getTime(); t <= maxDate.getTime(); t += 86400000) {
            const d = new Date(t);
            if (!openDayKeys.has(keyOf(d))) disabledDates.push(d);
        }
    }
    const renderDay = (date: Date) => {
        if (openDayKeys.has(keyOf(date))) return <span>{date.getDate()}</span>;
        return (
            <span className="line-through decoration-2 decoration-slate-400">
                {date.getDate()}
                <span className="sr-only"> unavailable</span>
            </span>
        );
    };

    // The chosen day's times (both offered and greyed-with-reason), time-sorted.
    const dayTimes = selectedKey
        ? other.filter((s) => s.date === selectedKey).sort((a, b) => a.time.localeCompare(b.time))
        : [];

    const partyLine = feed
        ? (feed.familySeats === 1
            ? 'Days with an open time are selectable.'
            : 'Days with room for all ' + feed.familySeats + ' of your party are selectable.')
        : '';

    return (
        <>
            {/* The action row. Its own markup (not the Calendar import) so the icon
                matches the other rows. */}
            <button type="button" onClick={openModal}
                className={className || 'text-sm font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800'}>
                {className ? (
                    <>
                        <span className="flex items-center gap-3">
                            <CalendarIcon /> Change date or time
                        </span>
                        <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                    </>
                ) : 'Change date or time'}
            </button>

            {open && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-0 sm:items-center sm:px-4" onClick={closeModal}>
                    <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 pt-5">
                            <h2 className="text-lg font-bold text-slate-900">Change date or time</h2>
                            <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">
                            {loadErr ? (
                                <p className="text-sm text-rose-600">{loadErr}</p>
                            ) : !feed ? (
                                <p className="text-sm text-slate-400">Loading…</p>
                            ) : (
                                <div className="space-y-4">
                                    <div className="rounded-lg bg-slate-50 p-3 text-sm">
                                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{feed.itemName || 'Your booking'}</div>
                                        <div className="mt-1 text-slate-700">
                                            Currently <span className="font-semibold text-slate-900">{whenLabel(feed.current.date, feed.current.time)}</span>.
                                        </div>
                                        <div className="mt-0.5 text-[13px] text-slate-500">{partyLine}</div>
                                    </div>

                                    {openDayKeys.size === 0 ? (
                                        <p className="text-sm text-slate-600">There are no other sessions open to move this booking to right now.</p>
                                    ) : (
                                        <>
                                            <div className="rdr-move overflow-hidden rounded-xl border border-slate-200">
                                                <Calendar
                                                    date={selectedKey ? dateFromKey(selectedKey) : currentDate}
                                                    shownDate={currentDate}
                                                    onChange={(d: Date) => { setSelectedKey(keyOf(d)); setPicked(null); setError(null); }}
                                                    minDate={minDate}
                                                    maxDate={maxDate}
                                                    disabledDates={disabledDates}
                                                    color="#047857"
                                                    dayContentRenderer={renderDay}
                                                />
                                            </div>

                                            {selectedKey && (
                                                <div>
                                                    <div className="text-[13px] font-semibold text-slate-700">{dayLabel(selectedKey)}</div>
                                                    {dayTimes.length === 0 ? (
                                                        <p className="mt-1 text-[13px] text-slate-500">No times on this day.</p>
                                                    ) : (
                                                        <div className="mt-2 flex flex-wrap gap-2">
                                                            {dayTimes.map((s) => {
                                                                const isPicked = !!picked && picked.date === s.date && picked.time === s.time;
                                                                if (!s.available) {
                                                                    return (
                                                                        <span key={s.time}
                                                                            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400"
                                                                            title={reasonLabel(s.reason, s)}>
                                                                            <span className="line-through">{s.time}</span>
                                                                            <span className="text-[11px] uppercase tracking-wide">· {reasonLabel(s.reason, s)}</span>
                                                                        </span>
                                                                    );
                                                                }
                                                                return (
                                                                    <button key={s.time} type="button"
                                                                        onClick={() => { setPicked({ date: s.date, time: s.time }); setError(null); }}
                                                                        className={
                                                                            'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition ' +
                                                                            (isPicked
                                                                                ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                                                                                : 'border-slate-300 text-slate-700 hover:border-slate-400')
                                                                        }>
                                                                        {isPicked ? <Check className="h-4 w-4" /> : null}
                                                                        {s.time}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                    {dayTimes.some((s) => !s.available) && (
                                                        <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
                                                            Greyed times can’t take this booking: <span className="font-medium">Full</span> — no room for your whole party;
                                                            {' '}<span className="font-medium">Too close</span> — inside that session’s cancellation cutoff;
                                                            {' '}<span className="font-medium">Private/Shared</span> — a different kind of booking to yours.
                                                        </p>
                                                    )}
                                                </div>
                                            )}

                                            {error && <p className="text-[13px] text-rose-600">{error}</p>}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        {feed && openDayKeys.size > 0 && !loadErr && (
                            <div className="border-t border-slate-100 p-4">
                                <button type="button" disabled={!picked || busy} onClick={proceed}
                                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    {picked ? 'Move to ' + whenLabel(picked.date, picked.time) : 'Pick a new time'}
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

// The small calendar glyph on the action row, matching the other rows' icons.
function CalendarIcon() {
    return (
        <svg className="h-4 w-4 flex-none text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
        </svg>
    );
}
