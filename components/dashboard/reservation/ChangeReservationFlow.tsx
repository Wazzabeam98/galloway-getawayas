'use client';

import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

// The "Change reservation" form, used by BOTH sides: a host proposes (the guest
// accepts) or a guest requests (the host approves). Three levers — dates, guest
// count, pets — and the new total is priced by the server from the listing's
// rates, so the person sees the real charge/refund before they commit. Nothing
// moves until the other side agrees.
export default function ChangeReservationFlow({
    bookingId, role, counterpartyName, checkIn, checkOut, adults, childrenCount, pets,
    maxGuests, petsAllowed, onClose,
}: {
    bookingId: string;
    role: 'host' | 'guest';
    counterpartyName: string;   // the OTHER party's first name
    checkIn: string;
    checkOut: string;
    adults: number;
    childrenCount: number;
    pets: number;
    maxGuests: number;
    petsAllowed: boolean;
    onClose: () => void;
}) {
    const [ci, setCi] = useState(checkIn);
    const [co, setCo] = useState(checkOut);
    const [ad, setAd] = useState(adults);
    const [ch, setCh] = useState(childrenCount);
    const [pt, setPt] = useState(pets);
    const [quote, setQuote] = useState<{ total: number; delta: number } | null>(null);
    const [quoting, setQuoting] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const round2 = (v: number) => Math.round(Number(v || 0) * 100) / 100;
    const guests = ad + ch;
    const changed = ci !== checkIn || co !== checkOut || guests !== (adults + childrenCount) || ch !== childrenCount || pt !== pets;
    const datesOk = !!ci && !!co && co > ci;
    const capacityOk = guests >= 1 && guests <= maxGuests && ch <= guests;

    // Re-price from the server whenever a lever moves (debounced).
    const seq = useRef(0);
    useEffect(() => {
        if (!changed || !datesOk || !capacityOk) { setQuote(null); return; }
        const mine = ++seq.current;
        setQuoting(true);
        const t = setTimeout(async () => {
            try {
                const res = await fetch('/api/bookings/change/quote', {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ bookingId, checkIn: ci, checkOut: co, guests, children: ch, pets: pt }),
                });
                const body = await res.json().catch(() => ({}));
                if (mine === seq.current) setQuote(res.ok ? { total: round2(body.total), delta: round2(body.delta) } : null);
            } catch { if (mine === seq.current) setQuote(null); }
            if (mine === seq.current) setQuoting(false);
        }, 350);
        return () => clearTimeout(t);
    }, [ci, co, ad, ch, pt]); // eslint-disable-line react-hooks/exhaustive-deps

    const canSend = changed && datesOk && capacityOk && !quoting && !busy;

    const submit = async () => {
        if (!canSend) return;
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/bookings/change', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ bookingId, checkIn: ci, checkOut: co, guests, children: ch, pets: pt }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) { setError(body?.error || 'Could not do that.'); setBusy(false); return; }
            setDone(true);
        } catch {
            setError('Something went wrong. Try again.');
        }
        setBusy(false);
    };

    if (done) {
        const sentTo = role === 'host' ? counterpartyName : 'your host';
        return (
            <div className="py-2">
                <p className="text-sm text-slate-700">Sent to {sentTo}. They’ll get an email to {role === 'host' ? 'confirm' : 'approve'} the change, and nothing moves until they do.</p>
                <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white">Done</button>
            </div>
        );
    }

    const delta = quote ? quote.delta : null;

    return (
        <div className="space-y-4">
            <p className="text-[13px] text-slate-500">
                {role === 'host'
                    ? 'Make your changes, then send a request to ' + counterpartyName + ' to confirm.'
                    : 'Make your changes, then send a request to your host to approve.'}
                {' '}Money only moves once it’s agreed.
            </p>

            <div>
                <label className="block text-[13px] font-semibold text-slate-700">Dates</label>
                <div className="mt-1 flex items-center gap-2">
                    <input type="date" value={ci} onChange={(e) => setCi(e.target.value)} className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-base" style={{ fontSize: 16 }} />
                    <span className="text-slate-400">→</span>
                    <input type="date" value={co} min={ci} onChange={(e) => setCo(e.target.value)} className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-base" style={{ fontSize: 16 }} />
                </div>
                {!datesOk && <p className="mt-1 text-[12px] text-rose-600">The checkout date must be after check-in.</p>}
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
                <Stepper label="Adults" sub="Ages 13+" value={ad} onChange={setAd} min={1} />
                <Stepper label="Children" sub="Ages 2–12" value={ch} onChange={setCh} min={0} />
                {petsAllowed && <Stepper label="Pets" sub="Assistance animals excluded" value={pt} onChange={setPt} min={0} />}
                <p className="mt-1 text-[12px] text-slate-500">
                    Up to {maxGuests} guests{petsAllowed ? ' (pets don’t count)' : ''}.
                    {!capacityOk && <span className="text-rose-600"> That’s over the limit.</span>}
                </p>
            </div>

            {changed && datesOk && capacityOk && (
                <div className="rounded-xl bg-slate-50 p-3 text-[13px] text-slate-600">
                    {quoting || delta === null
                        ? 'Pricing the change…'
                        : delta > 0
                            ? <>New total <strong>£{quote!.total.toFixed(2)}</strong> — {role === 'host' ? counterpartyName + ' pays' : 'you pay'} an extra <strong>£{delta.toFixed(2)}</strong>.</>
                            : delta < 0
                                ? <>New total <strong>£{quote!.total.toFixed(2)}</strong> — {role === 'host' ? counterpartyName + ' is refunded' : 'you’re refunded'} <strong>£{Math.abs(delta).toFixed(2)}</strong>.</>
                                : <>New total <strong>£{quote!.total.toFixed(2)}</strong> — nothing extra to pay.</>}
                </div>
            )}

            {error && <p className="text-[13px] text-rose-600">{error}</p>}

            <button type="button" disabled={!canSend} onClick={submit} className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-40">
                {busy ? 'Sending…' : role === 'host' ? 'Send request' : 'Request this change'}
            </button>
        </div>
    );
}

function Stepper({ label, sub, value, onChange, min }: { label: string; sub: string; value: number; onChange: (v: number) => void; min: number }) {
    return (
        <div className="flex items-center justify-between py-2">
            <div>
                <div className="text-sm font-semibold text-slate-900">{label}</div>
                <div className="text-[12px] text-slate-500">{sub}</div>
            </div>
            <div className="flex items-center gap-3">
                <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className="grid h-8 w-8 place-items-center rounded-full border border-slate-300 text-slate-600 disabled:opacity-30">
                    <Minus className="h-4 w-4" />
                </button>
                <span className="w-5 text-center text-sm font-semibold text-slate-900">{value}</span>
                <button type="button" onClick={() => onChange(value + 1)} className="grid h-8 w-8 place-items-center rounded-full border border-slate-300 text-slate-600">
                    <Plus className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
