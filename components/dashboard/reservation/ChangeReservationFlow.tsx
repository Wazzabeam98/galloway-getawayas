'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Minus, Plus, ChevronDown, CalendarDays, Users } from 'lucide-react';
import ChangeCalendar from '@/components/reservations/ChangeCalendar';

// "What do you want to change?" — Airbnb's change-reservation shape, used by both
// sides. A listing card and the reservation details up top; a Dates box that
// opens a two-month calendar; a Guests dropdown of Adults / Children / Infants /
// Pets steppers with the listing's limits; and a request-style summary. The new
// total is priced by the server (a diff against what was booked), so the person
// sees the real charge or refund before they send it. Nothing moves until the
// other side agrees.
export default function ChangeReservationFlow({
    bookingId, listingId, listingTitle, listingImage, role, counterpartyName,
    checkIn, checkOut, adults, childrenCount, pets, maxGuests, petsAllowed, onClose,
    startGuestsOpen = false,
}: {
    bookingId: string;
    listingId: string;
    listingTitle: string;
    listingImage: string | null;
    role: 'host' | 'guest';
    counterpartyName: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    childrenCount: number;
    pets: number;
    maxGuests: number;
    petsAllowed: boolean;
    onClose: () => void;
    // "Change guest count" opens this same form with the Guests dropdown already
    // expanded and the dates left as they are — same pricing, limits and approval.
    startGuestsOpen?: boolean;
}) {
    const [ci, setCi] = useState(checkIn);
    const [co, setCo] = useState(checkOut);
    const [ad, setAd] = useState(adults);
    const [ch, setCh] = useState(childrenCount);
    const [inf, setInf] = useState(0);
    const [pt, setPt] = useState(pets);
    const [showCal, setShowCal] = useState(false);
    const [showGuests, setShowGuests] = useState(startGuestsOpen);
    const [quote, setQuote] = useState<{ total: number; delta: number } | null>(null);
    const [quoting, setQuoting] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [appliedInstant, setAppliedInstant] = useState(false);

    const guests = ad + ch;                       // infants don't count toward the max or the price
    const atMax = guests >= maxGuests;
    // Infants are deliberately left out of "changed": they move no money and
    // aren't stored on the booking, so bumping only infants shouldn't send a no-op.
    const changed = ci !== checkIn || co !== checkOut || guests !== (adults + childrenCount) || ch !== childrenCount || pt !== pets;
    const datesOk = !!ci && !!co && co > ci;
    const capacityOk = guests >= 1 && guests <= maxGuests && ch <= guests && (petsAllowed || pt === 0);

    const seq = useRef(0);
    useEffect(() => {
        if (!changed || !datesOk || !capacityOk) { setQuote(null); return; }
        const mine = ++seq.current; setQuoting(true);
        const t = setTimeout(async () => {
            try {
                const res = await fetch('/api/bookings/change/quote', {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ bookingId, checkIn: ci, checkOut: co, guests, children: ch, pets: pt }),
                });
                const body = await res.json().catch(() => ({}));
                if (mine === seq.current) setQuote(res.ok ? { total: r2(body.total), delta: r2(body.delta) } : null);
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
            if (body?.applied) setAppliedInstant(true);
            setDone(true);
        } catch { setError('Something went wrong. Try again.'); }
        setBusy(false);
    };

    if (done) {
        const sentTo = role === 'host' ? counterpartyName : 'your host';
        return (
            <div className="py-2">
                <p className="text-sm text-slate-700">
                    {appliedInstant
                        ? 'Your booking is updated. We’ve let your host know.'
                        : <>Sent to {sentTo}. They’ll get an email to {role === 'host' ? 'confirm' : 'approve'} the change, and nothing moves until they do.</>}
                </p>
                <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white">Done</button>
            </div>
        );
    }

    const delta = quote ? quote.delta : null;
    const guestsSummary = ad + ' adult' + (ad === 1 ? '' : 's')
        + (ch ? ', ' + ch + ' child' + (ch === 1 ? '' : 'ren') : '')
        + (inf ? ', ' + inf + ' infant' + (inf === 1 ? '' : 's') : '')
        + (pt ? ', ' + pt + ' pet' + (pt === 1 ? '' : 's') : '');
    const limitLine = 'This place has a maximum of ' + maxGuests + ' guest' + (maxGuests === 1 ? '' : 's')
        + ', not including infants. ' + (petsAllowed ? 'Pets are welcome.' : 'Pets aren’t allowed.');

    return (
        <div className="space-y-4">
            {/* Listing card + reservation details */}
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5">
                {listingImage
                    ? <Image src={listingImage} alt="" width={56} height={56} className="h-14 w-14 flex-none rounded-lg object-cover" />
                    : <div className="h-14 w-14 flex-none rounded-lg bg-slate-100" />}
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{listingTitle}</div>
                    <div className="truncate text-[12px] text-slate-500">{fmtDay(checkIn)} → {fmtDay(checkOut)} · {adults + childrenCount} guest{(adults + childrenCount) === 1 ? '' : 's'}</div>
                </div>
            </div>

            <h2 className="text-base font-semibold text-slate-900">What do you want to change?</h2>

            {/* Dates box → calendar pop-up */}
            <div>
                <button type="button" onClick={() => { setShowCal((v) => !v); setShowGuests(false); }} className="flex w-full items-center gap-3 rounded-xl border border-slate-300 px-3 py-3 text-left">
                    <CalendarDays className="h-4 w-4 flex-none text-slate-400" />
                    <span className="flex-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dates</span>
                        <span className="block text-sm font-medium text-slate-900">{fmtDay(ci)} → {fmtDay(co)}</span>
                    </span>
                    <ChevronDown className={'h-4 w-4 flex-none text-slate-400 transition ' + (showCal ? 'rotate-180' : '')} />
                </button>
                {showCal && (
                    <div className="mt-2">
                        <ChangeCalendar listingId={listingId} ownCheckIn={checkIn} ownCheckOut={checkOut} checkIn={ci} checkOut={co}
                            onSave={(a, b) => { setCi(a); setCo(b); setShowCal(false); }} onClose={() => setShowCal(false)} />
                    </div>
                )}
            </div>

            {/* Guests dropdown → steppers */}
            <div>
                <button type="button" onClick={() => { setShowGuests((v) => !v); setShowCal(false); }} className="flex w-full items-center gap-3 rounded-xl border border-slate-300 px-3 py-3 text-left">
                    <Users className="h-4 w-4 flex-none text-slate-400" />
                    <span className="flex-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Guests</span>
                        <span className="block text-sm font-medium text-slate-900">{guestsSummary}</span>
                    </span>
                    <ChevronDown className={'h-4 w-4 flex-none text-slate-400 transition ' + (showGuests ? 'rotate-180' : '')} />
                </button>
                {showGuests && (
                    <div className="mt-2 rounded-xl border border-slate-200 p-3">
                        <Stepper label="Adults" sub="Ages 13+" value={ad} onChange={setAd} min={1} disablePlus={atMax} />
                        <Stepper label="Children" sub="Ages 2–12" value={ch} onChange={setCh} min={0} disablePlus={atMax} />
                        <Stepper label="Infants" sub="Under 2" value={inf} onChange={setInf} min={0} disablePlus={false} />
                        {petsAllowed && <Stepper label="Pets" sub="Assistance animals excluded" value={pt} onChange={setPt} min={0} disablePlus={false} />}
                        <p className="mt-2 text-[12px] text-slate-500">{limitLine}</p>
                    </div>
                )}
            </div>

            {/* Request-style summary */}
            {changed && datesOk && capacityOk && (
                <div className="rounded-xl bg-slate-50 p-3 text-[14px] text-slate-700">
                    {quoting || delta === null
                        ? 'Pricing the change…'
                        : role === 'guest'
                            ? (delta > 0 ? <>Your host will need to approve this, <strong>£{delta.toFixed(2)} more</strong>.</>
                                : delta < 0 ? <>Your host will need to approve this — you’ll get <strong>£{Math.abs(delta).toFixed(2)}</strong> back.</>
                                    : <>This updates your booking straight away.</>)
                            : (delta > 0 ? <>If {counterpartyName} accepts, they’ll pay <strong>£{delta.toFixed(2)}</strong> more.</>
                                : delta < 0 ? <>If {counterpartyName} accepts, they’ll get <strong>£{Math.abs(delta).toFixed(2)}</strong> back.</>
                                    : <>If {counterpartyName} accepts, there’s nothing extra to pay.</>)}
                </div>
            )}
            {!capacityOk && changed && <p className="text-[12px] text-rose-600">{!petsAllowed && pt > 0 ? 'This place doesn’t allow pets.' : 'That’s over the guest limit.'}</p>}

            {error && <p className="text-[13px] text-rose-600">{error}</p>}

            <button type="button" disabled={!canSend} onClick={submit} className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-40">
                {(() => {
                    const guestInstant = role === 'guest' && delta === 0;
                    if (busy) return guestInstant ? 'Updating…' : 'Sending…';
                    return guestInstant ? 'Update booking' : 'Send request';
                })()}
            </button>
        </div>
    );
}

function r2(v: number): number { return Math.round(Number(v || 0) * 100) / 100; }

// "2026-09-24" → "Thu 24 Sep" (never show the raw ISO date to a guest or host).
function fmtDay(s: string): string {
    if (!s) return '';
    const d = new Date(s + 'T12:00:00');
    return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function Stepper({ label, sub, value, onChange, min, disablePlus }: { label: string; sub: string; value: number; onChange: (v: number) => void; min: number; disablePlus: boolean }) {
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
                <button type="button" onClick={() => onChange(value + 1)} disabled={disablePlus} className="grid h-8 w-8 place-items-center rounded-full border border-slate-300 text-slate-600 disabled:opacity-30">
                    <Plus className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
