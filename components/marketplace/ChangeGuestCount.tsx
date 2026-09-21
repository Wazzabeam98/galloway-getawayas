'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Users, Minus, Plus, AlertTriangle, Loader2, ChevronRight, X } from 'lucide-react';
import { childrenAllowed } from '@/lib/guestAges';

// "Change guest count" — a reservation ACTION row that opens a MODAL over the
// page, the way Airbnb's reservation actions do (not an inline expander). The
// modal holds the guest-count stepper (adults + children) seeded at the current
// party, and as the count changes shows a Confirm-and-pay-shaped summary: the new
// count with the old struck through, a price-adjustment line and a total — the
// delta for the added places, charged as a separate payment. Past the
// session-anchored cancellation deadline it says the added place is
// non-refundable, before the card, and requires an acknowledgement.
//
// Per-person slot bookings only; the page decides whether to render the row.
// Payer-only and price-bearing — the page renders it for the booker alone, and
// the route is the real wall (a companion is refused and never handed the quote).

interface Quote {
    unitPrice: number;
    seatsLeft: number;
    headcount: number;
    adults: number | null;
    children: number | null;
    maxAddable: number;
    serviceDate: string;
    serviceTime: string | null;
    deadlineISO: string;
    insideWindow: boolean;
    itemName: string | null;
    // The provider's minimum age (null / 12 / 16 / 18 / 21). 16+ rules out the
    // whole 4–12 children band, so no children stepper is shown at all.
    minAge: number | null;
}

function money(n: number): string {
    return '£' + (Math.round(n * 100) / 100).toFixed(2);
}
function people(n: number, kind: 'adult' | 'child'): string {
    if (kind === 'adult') return n + (n === 1 ? ' adult' : ' adults');
    return n + (n === 1 ? ' child' : ' children');
}
function cutoffLabel(iso: string): string {
    try {
        return new Intl.DateTimeFormat('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short',
            hour: 'numeric', minute: '2-digit', timeZone: 'Europe/London',
        }).format(new Date(iso));
    } catch { return 'the cancellation deadline'; }
}

function Stepper({ label, value, set, min, max, disabled }: { label: string; value: number; set: (n: number) => void; min: number; max: number; disabled?: boolean }) {
    return (
        <div className="flex items-center justify-between py-1">
            <span className="text-sm text-slate-700">{label}</span>
            <div className="flex items-center gap-3">
                <button type="button" aria-label={'Fewer ' + label} disabled={disabled || value <= min}
                    onClick={() => set(Math.max(min, value - 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 disabled:opacity-40">
                    <Minus className="h-4 w-4" />
                </button>
                <span className="w-5 text-center text-sm font-semibold text-slate-900">{value}</span>
                <button type="button" aria-label={'More ' + label} disabled={disabled || value >= max}
                    onClick={() => set(Math.min(max, value + 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 disabled:opacity-40">
                    <Plus className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}

export default function ChangeGuestCount({ orderId, className }: { orderId: string; className?: string }) {
    const [open, setOpen] = useState(false);
    const [quote, setQuote] = useState<Quote | null>(null);
    const [loadErr, setLoadErr] = useState<string | null>(null);
    // The CURRENT party (seeded from the quote); the stepper only moves up.
    const [adults, setAdults] = useState(1);
    const [children, setChildren] = useState(0);
    const [ack, setAck] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function loadQuote() {
        setLoadErr(null);
        try {
            const r = await fetch('/api/services/slots/top-up?orderId=' + encodeURIComponent(orderId));
            const d = await r.json();
            if (!r.ok || !d.ok) { setLoadErr(d && d.error ? d.error : 'Could not load this.'); return; }
            const q = d as Quote;
            setQuote(q);
            setAdults(q.adults != null ? q.adults : Math.max(1, q.headcount));
            setChildren(q.children != null ? q.children : 0);
            setAck(false); setError(null);
        } catch { setLoadErr('Could not load this.'); }
    }

    function openModal() {
        setOpen(true);
        loadQuote();
    }
    function closeModal() { setOpen(false); }

    const oldAdults = quote ? (quote.adults != null ? quote.adults : Math.max(1, quote.headcount)) : 1;
    const oldChildren = quote ? (quote.children != null ? quote.children : 0) : 0;
    const seatsLeft = quote ? quote.seatsLeft : 0;
    const added = (adults - oldAdults) + (children - oldChildren);
    const addedChildren = children - oldChildren;
    const delta = quote ? quote.unitPrice * added : 0;
    const needsAck = quote ? quote.insideWindow : false;
    const canPay = !!quote && added >= 1 && !busy && (!needsAck || ack);

    const adultsMax = oldAdults + Math.max(0, seatsLeft - (children - oldChildren));
    const childrenMax = oldChildren + Math.max(0, seatsLeft - (adults - oldAdults));
    // 16+/18+/21+ experiences take no children — no stepper, not a disabled one.
    const kidsOk = childrenAllowed(quote ? quote.minAge : null);

    async function proceed() {
        if (!quote) return;
        setBusy(true); setError(null);
        try {
            const r = await fetch('/api/services/slots/top-up', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId, quantity: added, children: addedChildren }),
            });
            const d = await r.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start that.');
        } catch { setError('Could not start that.'); }
        setBusy(false);
    }

    // Strike through only a value that was ACTUALLY there before. 0 → N shows just
    // the new value (nothing to strike); N → 0 strikes the old value with nothing
    // after it; N → M (both non-zero) shows the struck old beside the new.
    const Diff = ({ oldN, newN, kind }: { oldN: number; newN: number; kind: 'adult' | 'child' }) => {
        const changed = newN !== oldN;
        const showOld = changed && oldN > 0;
        const showNew = newN > 0;
        return (
            <span className="text-sm text-slate-700">
                {showOld && <span className="text-slate-400 line-through">{people(oldN, kind)}</span>}
                {showOld && showNew ? ' ' : null}
                {showNew && <span className={changed ? 'font-semibold text-slate-900' : ''}>{people(newN, kind)}</span>}
            </span>
        );
    };

    // The row that opens the modal. A chevron marks it as opening a screen, like
    // the other navigating rows (and unlike Cancel, which expands in place).
    const trigger = (
        <button type="button" onClick={openModal}
            className={className || 'text-sm font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800'}>
            {className ? (
                <>
                    <span className="flex items-center gap-3"><Users className="h-4 w-4 flex-none text-slate-400" /> Change guest count</span>
                    <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                </>
            ) : 'Change guest count'}
        </button>
    );

    return (
        <>
            {trigger}

            {open && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 px-0 sm:items-center sm:px-4" onClick={closeModal}>
                    <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 pt-5">
                            <h2 className="text-lg font-bold text-slate-900">Change guest count</h2>
                            <button type="button" onClick={closeModal} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">
                            {loadErr ? (
                                <p className="text-sm text-rose-600">{loadErr}</p>
                            ) : !quote ? (
                                <p className="text-sm text-slate-400">Loading…</p>
                            ) : quote.seatsLeft < 1 ? (
                                <p className="text-sm text-slate-600">This session is full — there are no more places to add.</p>
                            ) : (
                                <div className="space-y-3">
                                    <Stepper label="Adults" value={adults} set={setAdults} min={oldAdults} max={adultsMax} />
                                    {kidsOk && (
                                        <Stepper label="Children (4–12)" value={children} set={setChildren} min={oldChildren} max={childrenMax} />
                                    )}

                                    <div className="rounded-lg bg-slate-50 p-3">
                                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{quote.itemName || 'Your booking'}</div>
                                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                            <Diff oldN={oldAdults} newN={adults} kind="adult" />
                                            {(children > 0 || oldChildren > 0) && <Diff oldN={oldChildren} newN={children} kind="child" />}
                                        </div>
                                        <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-sm">
                                            <div className="flex items-center justify-between text-slate-600">
                                                <span>Price adjustment{added > 0 ? ' · ' + added + (added === 1 ? ' place' : ' places') : ''}</span>
                                                <span>{money(delta)}</span>
                                            </div>
                                            <div className="flex items-center justify-between font-semibold text-slate-900">
                                                <span>Total</span>
                                                <span>{money(delta)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {needsAck ? (
                                        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                                            <div className="flex items-start gap-2">
                                                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-700" aria-hidden />
                                                <div className="text-[13px] text-amber-900">
                                                    <p className="font-semibold">This place can’t be refunded.</p>
                                                    <p className="mt-0.5">The free-cancellation deadline ({cutoffLabel(quote.deadlineISO)}) has passed, so a place added now is non-refundable from the moment you pay — the same as the rest of this booking.</p>
                                                    <label className="mt-2 flex items-start gap-2">
                                                        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
                                                        <span>I understand this added place isn’t refundable.</span>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-[13px] text-slate-500">Free to cancel until {cutoffLabel(quote.deadlineISO)}; after that an added place isn’t refundable.</p>
                                    )}

                                    {error && <p className="text-[13px] text-rose-600">{error}</p>}
                                </div>
                            )}
                        </div>

                        {quote && quote.seatsLeft >= 1 && !loadErr && (
                            <div className="border-t border-slate-100 p-4">
                                <button type="button" disabled={!canPay} onClick={proceed}
                                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    {added >= 1 ? 'Continue to payment · ' + money(delta) : 'Continue to payment'}
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
