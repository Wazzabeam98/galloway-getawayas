'use client';

import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Paperclip, X } from 'lucide-react';

// The host's "Send or request money" flow, Airbnb's Resolution Centre shape:
// choose direction → reason → amount + attachments + note → confirm. A REQUEST is
// recorded and the guest is emailed to accept/pay, decline or counter; a SEND
// takes the host to a one-off Stripe page and refunds the guest once it clears.
type Step = 'choose' | 'reason' | 'details' | 'confirm' | 'done';
type Direction = 'request' | 'send';
type Reason = 'extra_services' | 'damage';

const NOTE_MAX = 1000;

export default function ResolutionFlow({
    bookingId, guestFirst, afterCheckout, netPaid, onClose,
}: {
    bookingId: string;
    guestFirst: string;
    afterCheckout: boolean;   // damage is only offered once the stay is over
    netPaid: number;          // the most a send may refund
    onClose: () => void;
}) {
    const [step, setStep] = useState<Step>('choose');
    const [direction, setDirection] = useState<Direction | null>(null);
    const [reason, setReason] = useState<Reason | null>(null);
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const amountNum = Math.round(Number(amount) * 100) / 100;
    const amountValid = amountNum > 0 && (direction !== 'send' || amountNum <= netPaid);

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
            {step === 'choose' && (
                <div className="space-y-2">
                    <p className="mb-1 text-sm text-slate-600">What would you like to do?</p>
                    <Choice icon={ArrowDownLeft} label="Request money" sub="Ask the guest for money — extra services or damage" onClick={() => { setDirection('request'); setStep('reason'); }} />
                    <Choice icon={ArrowUpRight} label="Send money" sub={netPaid > 0 ? 'Send the guest a refund (you pay, we refund them)' : 'Nothing to send — the guest hasn’t paid'} disabled={netPaid <= 0} onClick={() => { setDirection('send'); setReason('extra_services'); setStep('details'); }} />
                </div>
            )}

            {step === 'reason' && (
                <div className="space-y-2">
                    <p className="mb-1 text-sm text-slate-600">What is this request for?</p>
                    <Choice label="Extra services" sub="Meals, transport or amenities not in the listing" onClick={() => { setReason('extra_services'); setStep('details'); }} />
                    <Choice label="Damage or extra cleaning" sub={afterCheckout ? 'Reimbursement for damage during the stay' : 'Available after the guest checks out'} disabled={!afterCheckout} onClick={() => { setReason('damage'); setStep('details'); }} />
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

                    <button type="button" disabled={!amountValid} onClick={() => setStep('confirm')} className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-40">Continue</button>
                </div>
            )}

            {step === 'confirm' && direction && (
                <div className="space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                        <Line k={direction === 'send' ? 'Sending' : 'Requesting'} v={'£' + amountNum.toFixed(2)} />
                        <Line k="Reason" v={reason === 'damage' ? 'Damage or extra cleaning' : 'Extra services'} />
                        {files.length > 0 && <Line k="Attachments" v={files.length + ' file' + (files.length > 1 ? 's' : '')} />}
                        {note && <p className="mt-2 border-t border-slate-200 pt-2 text-[13px] text-slate-600">“{note}”</p>}
                    </div>
                    <p className="text-[13px] text-slate-500">
                        {direction === 'send'
                            ? 'You’ll pay £' + amountNum.toFixed(2) + ' on the next screen. Once it clears, we refund ' + guestFirst + ' the same amount to their original card.'
                            : guestFirst + ' can accept and pay, decline, or suggest a different amount.'}
                    </p>
                    {error && <p className="text-[13px] text-rose-600">{error}</p>}
                    <button type="button" disabled={busy} onClick={submit} className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                        {busy ? 'Working…' : direction === 'send' ? 'Continue to payment' : 'Confirm and request'}
                    </button>
                </div>
            )}
        </div>
    );
}

function Choice({ icon: Icon, label, sub, onClick, disabled }: { icon?: any; label: string; sub?: string; onClick: () => void; disabled?: boolean }) {
    return (
        <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50">
            {Icon && <Icon className="h-5 w-5 flex-none text-emerald-700" />}
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">{label}</span>
                {sub && <span className="block text-[13px] text-slate-500">{sub}</span>}
            </span>
        </button>
    );
}

function Line({ k, v }: { k: string; v: string }) {
    return <div className="flex justify-between py-0.5"><span className="text-slate-500">{k}</span><span className="font-semibold text-slate-900">{v}</span></div>;
}
