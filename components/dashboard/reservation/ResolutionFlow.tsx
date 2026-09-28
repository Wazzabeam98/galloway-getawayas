'use client';

import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Paperclip, X, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { REQUEST_REASONS, SEND_REASONS, reasonLabel, type ResolutionReason } from '@/lib/resolutions';

// The host's "Send or request money" flow, Airbnb's Resolution Centre shape but in
// our own styling: a stepped wizard with a progress bar and Back / Next.
//   1 — send or request? (with who it concerns: the guest, their dates, party
//       and listing, so the host knows which booking they're acting on)
//   2 — what it's for. Our own reasons, not Airbnb's:
//         request → extra services, damage, or other
//         send    → a goodwill refund, a change to the booking, or other
//   3 — the amount, any attachments and a note, then confirm.
// The money rules are unchanged and enforced server-side: the 10% on an
// extra-services request, nothing on damage or a send, the send cap (net paid)
// and the 72-hour window. A REQUEST is recorded and the guest is emailed to
// accept/pay, decline or counter; a SEND opens a one-off Stripe page and refunds
// the guest once it clears.
type Step = 'choose' | 'reason' | 'details' | 'done';
type Direction = 'request' | 'send';

const NOTE_MAX = 1000;
const ORDER: Step[] = ['choose', 'reason', 'details'];

function dateRange(checkIn: string, checkOut: string): string {
    const fmt = (iso: string, withYear: boolean) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
    });
    if (!checkIn || !checkOut) return '';
    const sameYear = checkIn.slice(0, 4) === checkOut.slice(0, 4);
    return fmt(checkIn, !sameYear) + ' – ' + fmt(checkOut, true);
}

export default function ResolutionFlow({
    bookingId, guestFirst, afterCheckout, netPaid, onClose,
    guestParty, checkIn, checkOut, listingTitle,
}: {
    bookingId: string;
    guestFirst: string;
    afterCheckout: boolean;   // damage is only offered once the stay is over
    netPaid: number;          // the most a send may refund
    onClose: () => void;
    // Who the money concerns — shown on step one so the host acts on the right
    // booking. Defaulted so any older caller still compiles.
    guestParty?: number;
    checkIn?: string;
    checkOut?: string;
    listingTitle?: string;
}) {
    const [step, setStep] = useState<Step>('choose');
    const [direction, setDirection] = useState<Direction | null>(null);
    const [reason, setReason] = useState<ResolutionReason | null>(null);
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const amountNum = Math.round(Number(amount) * 100) / 100;
    const amountValid = amountNum > 0 && (direction !== 'send' || amountNum <= netPaid);

    // A reason is only valid for its direction, and damage needs the stay to be
    // over — the same gate the server applies, mirrored here so the tile is
    // disabled rather than the submit rejected.
    const reasonUsable = (r: ResolutionReason) => r !== 'damage' || afterCheckout;
    const reasons = direction === 'send' ? SEND_REASONS : REQUEST_REASONS;

    const reasonSub: Record<ResolutionReason, string> = {
        extra_services: 'Meals, transport or amenities not in the listing',
        damage: afterCheckout ? 'Reimbursement for damage during the stay' : 'Available after the guest checks out',
        goodwill_refund: 'A gesture back to the guest',
        booking_change: 'Money owed after a change to the stay',
        other: 'Something else — explain it in the note',
    };

    const stepIndex = ORDER.indexOf(step as any);
    const canNext = step === 'choose' ? !!direction : step === 'reason' ? !!reason : amountValid;

    const goBack = () => {
        setError(null);
        if (step === 'reason') setStep('choose');
        else if (step === 'details') setStep('reason');
    };
    const goNext = () => {
        setError(null);
        if (step === 'choose' && direction) setStep('reason');
        else if (step === 'reason' && reason) setStep('details');
    };

    const submit = async () => {
        if (!direction || !reason || !amountValid) return;
        setBusy(true); setError(null);
        try {
            const fd = new FormData();
            fd.set('bookingId', bookingId);
            fd.set('direction', direction);
            fd.set('reason', reason);
            fd.set('amount', String(amountNum));
            fd.set('note', note);
            for (const f of files) fd.append('files', f);
            const res = await fetch('/api/bookings/resolutions', { method: 'POST', body: fd });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) { setError(body?.error || 'Could not do that.'); setBusy(false); return; }
            if (body.url) { window.location.href = body.url; return; }   // send → Stripe
            setStep('done');
        } catch {
            setError('Something went wrong. Try again.');
        }
        setBusy(false);
    };

    if (step === 'done') {
        return (
            <div className="text-center py-4">
                <p className="text-sm font-semibold text-slate-900">Request sent to {guestFirst}.</p>
                <p className="mt-1 text-[13px] text-slate-500">They can accept and pay, decline, or suggest a different amount. If they don’t respond within 72 hours, we step in.</p>
                <button type="button" onClick={onClose} className="mt-4 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Done</button>
            </div>
        );
    }

    return (
        <div>
            {/* Progress across the three steps. */}
            <div className="mb-4 flex items-center gap-1.5">
                {ORDER.map((s, i) => (
                    <span key={s} className={'h-1.5 flex-1 rounded-full transition ' + (i <= stepIndex ? 'bg-emerald-600' : 'bg-slate-200')} />
                ))}
            </div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Step {stepIndex + 1} of 3</p>

            {step === 'choose' && (
                <div className="space-y-3">
                    {/* Who this concerns — so the host is acting on the right stay. */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-sm font-semibold text-slate-900">{guestFirst}’s group of {Math.max(1, Number(guestParty) || 1)}</div>
                        <div className="mt-0.5 text-[13px] text-slate-500">
                            {[dateRange(checkIn || '', checkOut || ''), listingTitle].filter(Boolean).join(' · ')}
                        </div>
                    </div>
                    <p className="text-sm text-slate-600">What would you like to do?</p>
                    <Choice icon={ArrowDownLeft} label="Request money" sub="Ask the guest for money" selected={direction === 'request'} onClick={() => { setDirection('request'); setReason(null); }} />
                    <Choice icon={ArrowUpRight} label="Send money" sub={netPaid > 0 ? 'Send the guest a refund (you pay, we refund them)' : 'Nothing to send — the guest hasn’t paid'} selected={direction === 'send'} disabled={netPaid <= 0} onClick={() => { setDirection('send'); setReason(null); }} />
                </div>
            )}

            {step === 'reason' && (
                <div className="space-y-2">
                    <p className="mb-1 text-sm text-slate-600">{direction === 'send' ? 'What is this refund for?' : 'What is this request for?'}</p>
                    {reasons.map((r) => (
                        <Choice
                            key={r}
                            label={reasonLabel(r)}
                            sub={reasonSub[r]}
                            selected={reason === r}
                            disabled={!reasonUsable(r)}
                            onClick={() => setReason(r)}
                        />
                    ))}
                </div>
            )}

            {step === 'details' && (
                <div className="space-y-3">
                    <label className="block">
                        <span className="text-sm font-semibold text-slate-900">{direction === 'send' ? 'Amount to send' : 'Amount to request'}</span>
                        <div className="mt-1 flex items-center rounded-xl border border-slate-300 px-3">
                            <span className="text-slate-500">£</span>
                            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full py-2.5 pl-1 text-base outline-none" style={{ fontSize: 16 }} />
                        </div>
                        {direction === 'send' && <span className="mt-1 block text-[12px] text-slate-500">Up to £{netPaid.toFixed(2)} — what {guestFirst} has paid, net of refunds.</span>}
                        {direction === 'send' && amountNum > netPaid && <span className="mt-1 block text-[12px] text-rose-600">That’s more than the £{netPaid.toFixed(2)} they’ve paid.</span>}
                        {direction === 'request' && reason === 'extra_services' && <span className="mt-1 block text-[12px] text-slate-500">Our 10% fee comes off an extra-services request.</span>}
                    </label>

                    <div>
                        <span className="text-sm font-semibold text-slate-900">Attachments <span className="font-normal text-slate-400">(optional)</span></span>
                        <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-[13px] text-slate-600 hover:border-slate-400">
                            <Paperclip className="h-4 w-4 text-slate-400" />
                            Add photos or a PDF receipt
                            <input type="file" accept="image/png,image/jpeg,application/pdf" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
                        </label>
                        {files.length > 0 && (
                            <ul className="mt-1.5 space-y-1">
                                {files.map((f, i) => (
                                    <li key={i} className="flex items-center gap-2 text-[13px] text-slate-600">
                                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                                        <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-slate-400 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <label className="block">
                        <span className="text-sm font-semibold text-slate-900">Note to {guestFirst}</span>
                        <textarea value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={direction === 'send' ? 'Let them know what this is for' : 'Let them know why you’re requesting this'} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none" style={{ fontSize: 16 }} />
                        <span className="mt-0.5 block text-right text-[12px] text-slate-400">{note.length}/{NOTE_MAX}</span>
                    </label>

                    {/* What happens on confirm — the money made plain before the button. */}
                    {amountValid && (
                        <p className="text-[13px] text-slate-500">
                            {direction === 'send'
                                ? 'You’ll pay £' + amountNum.toFixed(2) + ' on the next screen. Once it clears, we refund ' + guestFirst + ' the same amount to their original card.'
                                : guestFirst + ' can accept and pay, decline, or suggest a different amount. If they don’t respond within 72 hours, we step in.'}
                        </p>
                    )}
                    {error && <p className="text-[13px] text-rose-600">{error}</p>}
                </div>
            )}

            {/* Back / Next — Next becomes the submit on the final step. */}
            <div className="mt-5 flex items-center justify-between gap-3">
                {step === 'choose' ? (
                    <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500 hover:text-slate-800">Cancel</button>
                ) : (
                    <button type="button" onClick={goBack} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-800">
                        <ChevronLeft className="h-4 w-4" /> Back
                    </button>
                )}
                {step === 'details' ? (
                    <button type="button" disabled={busy || !amountValid} onClick={submit} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                        {busy ? 'Working…' : direction === 'send' ? 'Continue to payment' : 'Confirm and request'}
                        {!busy && <Check className="h-4 w-4" />}
                    </button>
                ) : (
                    <button type="button" disabled={!canNext} onClick={goNext} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-40">
                        Next <ChevronRight className="h-4 w-4" />
                    </button>
                )}
            </div>
        </div>
    );
}

function Choice({ icon: Icon, label, sub, onClick, disabled, selected }: { icon?: any; label: string; sub?: string; onClick: () => void; disabled?: boolean; selected?: boolean }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={
                'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 '
                + (selected ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-slate-200 hover:border-slate-300')
            }
        >
            {Icon && <Icon className={'h-5 w-5 flex-none ' + (selected ? 'text-emerald-700' : 'text-emerald-700')} />}
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">{label}</span>
                {sub && <span className="block text-[13px] text-slate-500">{sub}</span>}
            </span>
            {selected && <Check className="h-4 w-4 flex-none text-emerald-700" />}
        </button>
    );
}
