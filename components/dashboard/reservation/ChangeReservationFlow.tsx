'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';

// The host's "Change reservation" — Airbnb's Flow 1 shape on one screen: new
// dates, a guest-count stepper and a re-priced total. Nothing moves here; "Send
// request" records the proposal and the guest must accept before any money or
// booking state changes. Disabled until something actually changes.
export default function ChangeReservationFlow({
    bookingId, guestFirst, checkIn, checkOut, adults, childrenCount, pets,
    maxGuests, petsAllowed, totalPrice, onClose,
}: {
    bookingId: string;
    guestFirst: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    childrenCount: number;
    pets: number;
    maxGuests: number;
    petsAllowed: boolean;
    totalPrice: number;
    onClose: () => void;
}) {
    const [ci, setCi] = useState(checkIn);
    const [co, setCo] = useState(checkOut);
    const [ad, setAd] = useState(adults);
    const [ch, setCh] = useState(childrenCount);
    const [pt, setPt] = useState(pets);
    const [price, setPrice] = useState(String(totalPrice.toFixed(2)));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const round2 = (v: number) => Math.round(Number(v || 0) * 100) / 100;
    const guests = ad + ch;
    const newTotal = round2(Number(price));
    const delta = round2(newTotal - totalPrice);

    const changed = ci !== checkIn || co !== checkOut || guests !== (adults + childrenCount)
        || ch !== childrenCount || pt !== pets || newTotal !== round2(totalPrice);
    const datesOk = !!ci && !!co && co > ci;
    const capacityOk = guests >= 1 && guests <= maxGuests && ch <= guests;
    const canSend = changed && datesOk && capacityOk && newTotal >= 0 && !busy;

    const submit = async () => {
        if (!canSend) return;
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/bookings/change', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ bookingId, checkIn: ci, checkOut: co, guests, children: ch, pets: pt, total: newTotal }),
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
        return (
            <div className="py-2">
                <p className="text-sm text-slate-700">Sent to {guestFirst}. They’ll get an email to confirm the change, and nothing moves until they accept.</p>
                <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white">Done</button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <p className="text-[13px] text-slate-500">Make your changes, then send a request to {guestFirst} to confirm. Money only moves once they accept.</p>

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

            <div>
                <label className="block text-[13px] font-semibold text-slate-700">Total price</label>
                <div className="mt-1 flex items-center rounded-xl border border-slate-300 px-3">
                    <span className="text-slate-500">£</span>
                    <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full py-2.5 pl-1 text-base outline-none" style={{ fontSize: 16 }} />
                </div>
            </div>

            {changed && (
                <div className="rounded-xl bg-slate-50 p-3 text-[13px] text-slate-600">
                    {delta > 0
                        ? <>{guestFirst} will be asked to pay an extra <strong>£{delta.toFixed(2)}</strong>.</>
                        : delta < 0
                            ? <>{guestFirst} will be refunded <strong>£{Math.abs(delta).toFixed(2)}</strong>.</>
                            : <>No change to what {guestFirst} pays.</>}
                </div>
            )}

            {error && <p className="text-[13px] text-rose-600">{error}</p>}

            <button type="button" disabled={!canSend} onClick={submit} className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-40">
                {busy ? 'Sending…' : 'Send request'}
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
