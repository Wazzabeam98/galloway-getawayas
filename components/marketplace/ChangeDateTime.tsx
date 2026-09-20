'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, Loader2, ChevronRight, X, Check } from 'lucide-react';

// "Change date or time" — a reservation ACTION row that opens a MODAL over the
// page, the same shape as "Change guest count". The modal loads the provider's
// sessions and shows only the ones this booking can legitimately move to — right
// mode (private vs shared), room for the WHOLE family, and not past that
// session's own cutoff — as selectable times, grouped by date. Times that exist
// but can't take this booking are shown greyed with a one-word reason, and a line
// explains what "unavailable" means, so the guest sees why a time is closed
// rather than it silently missing.
//
// Eligibility is decided server-side by the same rule the move RPC enforces
// (lib/experienceMove.moveTargetEligibility), so a time offered here is one the
// move will accept. Payer-only and state-changing — the page renders the row for
// the booker alone, and the route is the real wall.

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
    sessions: Session[];
}

function dayLabel(date: string): string {
    try {
        return new Intl.DateTimeFormat('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London',
        }).format(new Date(date + 'T12:00:00Z'));
    } catch { return date; }
}
function whenLabel(date: string, time: string): string {
    return dayLabel(date) + ' at ' + time;
}
// The short, greyed reason a time can't take this booking.
function reasonLabel(reason: string | null, session: Session): string {
    switch (reason) {
        case 'full': return 'Full';
        case 'cutoff': return 'Too close';
        case 'mode': return session.private ? 'Private' : 'Shared';
        case 'not-ready': return 'Unavailable';
        default: return 'Unavailable';
    }
}

export default function ChangeDateTime({ orderId, className }: { orderId: string; className?: string }) {
    const [open, setOpen] = useState(false);
    const [feed, setFeed] = useState<Feed | null>(null);
    const [loadErr, setLoadErr] = useState<string | null>(null);
    const [picked, setPicked] = useState<{ date: string; time: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        setLoadErr(null); setFeed(null); setPicked(null); setError(null);
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

    // The move targets sessions OTHER than the one they're on. Group the offered
    // ones by date; keep the ineligible ones (greyed) so a guest sees why a time
    // is closed, but drop the family's current session — it's marked, not offered.
    const shown = feed ? feed.sessions.filter((s) => s.reason !== 'current') : [];
    const anyAvailable = shown.some((s) => s.available);
    const byDate: { date: string; times: Session[] }[] = [];
    for (const s of shown) {
        const last = byDate[byDate.length - 1];
        if (last && last.date === s.date) last.times.push(s);
        else byDate.push({ date: s.date, times: [s] });
    }
    const partyLine = feed
        ? (feed.familySeats === 1
            ? 'Showing times you can move to.'
            : 'Showing times with room for all ' + feed.familySeats + ' of your party.')
        : '';

    const trigger = (
        <button type="button" onClick={openModal}
            className={className || 'text-sm font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800'}>
            {className ? (
                <>
                    <span className="flex items-center gap-3"><CalendarClock className="h-4 w-4 flex-none text-slate-400" /> Change date or time</span>
                    <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                </>
            ) : 'Change date or time'}
        </button>
    );

    return (
        <>
            {trigger}

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

                                    {!anyAvailable ? (
                                        <p className="text-sm text-slate-600">
                                            There are no other sessions open to move this booking to right now
                                            {shown.length > 0 ? ' — the times below are full, too close to change into, or a different kind of booking.' : '.'}
                                        </p>
                                    ) : null}

                                    {byDate.map((group) => (
                                        <div key={group.date}>
                                            <div className="text-[13px] font-semibold text-slate-700">{dayLabel(group.date)}</div>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {group.times.map((s) => {
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
                                        </div>
                                    ))}

                                    {shown.some((s) => !s.available) && (
                                        <p className="text-[12px] leading-relaxed text-slate-400">
                                            Greyed times can’t take this booking: <span className="font-medium">Full</span> — no room for your whole party;
                                            {' '}<span className="font-medium">Too close</span> — inside that session’s cancellation cutoff;
                                            {' '}<span className="font-medium">Private/Shared</span> — a different kind of booking to yours.
                                        </p>
                                    )}

                                    {error && <p className="text-[13px] text-rose-600">{error}</p>}
                                </div>
                            )}
                        </div>

                        {feed && anyAvailable && !loadErr && (
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
