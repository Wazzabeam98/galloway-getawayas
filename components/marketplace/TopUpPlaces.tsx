'use client';

import { useEffect, useState } from 'react';
import { Minus, Plus, UserPlus, AlertTriangle } from 'lucide-react';

// ADD GUESTS to a per-person slot booking — the payer buys more places on the
// same session. Payer-only (the route rejects anyone else, and a companion never
// sees this panel), per-person only. The panel fetches its own quote so a
// companion's browser is never handed the price.
//
// The one thing it must say plainly, before the card: the cancellation deadline
// is anchored to the SESSION, not to when the place is bought — so a place added
// after the deadline has passed is non-refundable from the moment it's paid.
// When that is the case the panel says so, with the actual cutoff, and asks the
// guest to confirm they understand before it will start Checkout.

interface Quote {
    unitPrice: number;
    seatsLeft: number;
    headcount: number;
    maxAddable: number;
    serviceDate: string;
    serviceTime: string | null;
    deadlineISO: string;
    insideWindow: boolean;
    itemName: string | null;
}

function money(n: number): string {
    return '£' + (Math.round(n * 100) / 100).toFixed(2);
}

// The cutoff, in the reader's local time — "Fri 25 Sep, 2:00 pm".
function cutoffLabel(iso: string): string {
    try {
        return new Intl.DateTimeFormat('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short',
            hour: 'numeric', minute: '2-digit', timeZone: 'Europe/London',
        }).format(new Date(iso));
    } catch {
        return 'the cancellation deadline';
    }
}

export default function TopUpPlaces({ orderId }: { orderId: string }) {
    const [quote, setQuote] = useState<Quote | null>(null);
    const [loadErr, setLoadErr] = useState<string | null>(null);
    const [added, setAdded] = useState(1);
    const [children, setChildren] = useState(0);
    const [showChildren, setShowChildren] = useState(false);
    const [ackNoRefund, setAckNoRefund] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        (async () => {
            try {
                const r = await fetch('/api/services/slots/top-up?orderId=' + encodeURIComponent(orderId));
                const d = await r.json();
                if (!live) return;
                if (!r.ok || !d.ok) { setLoadErr(d && d.error ? d.error : 'Could not load this.'); return; }
                setQuote(d as Quote);
            } catch {
                if (live) setLoadErr('Could not load this.');
            }
        })();
        return () => { live = false; };
    }, [orderId]);

    if (loadErr) return null;           // nothing to add, or not the payer — say nothing
    if (!quote) {
        return <p className="text-sm text-slate-400">Loading…</p>;
    }

    const max = Math.max(0, Math.min(quote.maxAddable, quote.seatsLeft));
    const full = max < 1;
    const clampedAdded = Math.min(Math.max(1, added), Math.max(1, max));
    const clampedChildren = Math.min(children, clampedAdded - 1);   // always ≥1 adult on the added places
    const adults = clampedAdded - clampedChildren;
    const delta = quote.unitPrice * clampedAdded;
    // A place added now is non-refundable when the session-anchored deadline has
    // already passed; the guest must tick the acknowledgement before we proceed.
    const needsAck = quote.insideWindow;
    const canPay = !full && !busy && (!needsAck || ackNoRefund);

    async function proceed() {
        setBusy(true);
        setError(null);
        try {
            const r = await fetch('/api/services/slots/top-up', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId, quantity: clampedAdded, children: clampedChildren }),
            });
            const d = await r.json();
            if (d && d.ok && d.url) { window.location.href = d.url; return; }
            setError((d && d.error) || 'Could not start that.');
        } catch {
            setError('Could not start that.');
        }
        setBusy(false);
    }

    const Stepper = ({ label, value, set, min, max: hi }: { label: string; value: number; set: (n: number) => void; min: number; max: number }) => (
        <div className="flex items-center justify-between">
            <span className="text-sm text-slate-700">{label}</span>
            <div className="flex items-center gap-3">
                <button type="button" aria-label={'Fewer ' + label} disabled={value <= min}
                    onClick={() => set(Math.max(min, value - 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 disabled:opacity-40">
                    <Minus className="h-4 w-4" />
                </button>
                <span className="w-5 text-center text-sm font-semibold text-slate-900">{value}</span>
                <button type="button" aria-label={'More ' + label} disabled={value >= hi}
                    onClick={() => set(Math.min(hi, value + 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 disabled:opacity-40">
                    <Plus className="h-4 w-4" />
                </button>
            </div>
        </div>
    );

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
            <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-emerald-700" aria-hidden />
                <h2 className="text-base font-semibold text-slate-900">Add guests</h2>
            </div>
            <p className="mt-1 text-[13px] text-slate-500">
                {quote.headcount} {quote.headcount === 1 ? 'place' : 'places'} booked so far.
                {full ? ' This session is now full.' : ` ${max} more ${max === 1 ? 'place' : 'places'} available.`}
            </p>

            {!full && (
                <div className="mt-4 space-y-3">
                    <Stepper label="Places to add" value={clampedAdded} set={setAdded} min={1} max={max} />

                    {showChildren ? (
                        <>
                            <Stepper label="of which children (4–12)" value={clampedChildren} set={setChildren} min={0} max={clampedAdded - 1} />
                            <p className="text-[13px] text-slate-500">{adults} {adults === 1 ? 'adult' : 'adults'}, {clampedChildren} {clampedChildren === 1 ? 'child' : 'children'} · same price each.</p>
                        </>
                    ) : (
                        <button type="button" onClick={() => setShowChildren(true)} className="text-[13px] font-medium text-emerald-700 hover:text-emerald-800">
                            Add children to the party
                        </button>
                    )}

                    <div className="flex items-baseline justify-between border-t border-slate-100 pt-3">
                        <span className="text-sm text-slate-600">{clampedAdded} × {money(quote.unitPrice)}</span>
                        <span className="text-lg font-semibold text-slate-900">{money(delta)}</span>
                    </div>

                    {needsAck ? (
                        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                            <div className="flex items-start gap-2">
                                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-700" aria-hidden />
                                <div className="text-[13px] text-amber-900">
                                    <p className="font-semibold">This place can’t be refunded.</p>
                                    <p className="mt-0.5">
                                        The free-cancellation deadline ({cutoffLabel(quote.deadlineISO)}) has passed,
                                        so a place added now is non-refundable from the moment you pay — the same as the rest of this booking.
                                    </p>
                                    <label className="mt-2 flex items-start gap-2">
                                        <input type="checkbox" checked={ackNoRefund} onChange={(e) => setAckNoRefund(e.target.checked)} className="mt-0.5" />
                                        <span>I understand this added place isn’t refundable.</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <p className="text-[13px] text-slate-500">
                            Free to cancel until {cutoffLabel(quote.deadlineISO)}; after that an added place isn’t refundable.
                        </p>
                    )}

                    {error && <p className="text-[13px] text-rose-600">{error}</p>}

                    <button type="button" disabled={!canPay} onClick={proceed}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                        {busy ? 'Starting…' : 'Continue to payment · ' + money(delta)}
                    </button>
                </div>
            )}
        </div>
    );
}
