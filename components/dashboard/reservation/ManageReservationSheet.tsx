'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    Pencil, ChevronRight, ChevronLeft, CalendarClock, Banknote, Flag,
    Phone, Copy, Check, MessageSquare, XCircle, Loader2,
} from 'lucide-react';
import Modal from './Modal';
import BookingActions from '@/components/BookingActions';

type View = 'menu' | 'money' | 'dispute' | 'cancel';

// The single "Manage reservation" row — a pencil that opens Airbnb's kind of
// action sheet. Every host action on a booking lives here: change the
// reservation, send or request money, raise a dispute, copy the guest's number,
// ask them to cancel, or cancel it. Money and cancellation reuse the existing
// BookingActions component, so the proven refund/cancel paths are not
// reimplemented — the sheet only gathers them in one place.
export default function ManageReservationSheet({
    bookingId,
    status,
    isOwner,
    ended,
    phone,
    guestFirst,
    totalPrice,
    amountPaid,
    amountRefunded,
    changeHref,
    askToCancelHref,
}: {
    bookingId: string;
    status: string;
    isOwner: boolean;
    ended: boolean;
    phone: string | null;
    guestFirst: string;
    totalPrice: number;
    amountPaid: number;
    amountRefunded: number;
    changeHref: string;
    askToCancelHref: string | null;
}) {
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<View>('menu');
    const closed = status === 'cancelled' || status === 'declined';

    const title =
        view === 'money' ? 'Send or request money'
            : view === 'dispute' ? 'Start a dispute'
                : view === 'cancel' ? 'Cancel booking'
                    : 'Manage reservation';

    return (
        <Modal
            open={open}
            onOpenChange={(v) => { setOpen(v); if (!v) setView('menu'); }}
            title={title}
            trigger={
                <button type="button" className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300">
                    <Pencil className="h-4 w-4 flex-none text-slate-400" />
                    <span className="flex-1 text-sm font-semibold text-slate-900">Manage reservation</span>
                    <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                </button>
            }
        >
            {view !== 'menu' && (
                <button type="button" onClick={() => setView('menu')} className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500 hover:text-slate-800">
                    <ChevronLeft className="h-4 w-4" /> Back
                </button>
            )}

            {view === 'menu' && (
                <div className="-my-1 divide-y divide-slate-100">
                    <Row icon={CalendarClock} label="Change reservation" sub="Propose new dates or party" href={changeHref} onNavigate={() => setOpen(false)} />
                    {!closed && <Row icon={Banknote} label="Send or request money" sub="Refund, or ask for a fee or change" onClick={() => setView('money')} />}
                    <Row icon={Flag} label="Start a dispute" sub="Ask us to look into a problem" onClick={() => setView('dispute')} />
                    {phone && (
                        <div className="flex items-center gap-3 py-3">
                            <Phone className="h-4 w-4 flex-none text-slate-400" />
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-slate-900">Guest’s phone</div>
                                <div className="text-[13px] text-slate-500">{phone}</div>
                            </div>
                            <CopyButton value={phone} />
                        </div>
                    )}
                    {isOwner && !closed && !ended && askToCancelHref && (
                        <Row icon={MessageSquare} label={'Ask ' + guestFirst + ' to cancel'} sub="Draft a message for them to cancel" href={askToCancelHref} onNavigate={() => setOpen(false)} />
                    )}
                    {!closed && (
                        <Row icon={XCircle} label="Cancel booking" sub={isOwner ? 'Call the stay off' : 'Stays with the owner'} danger onClick={() => setView('cancel')} />
                    )}
                    {closed && <p className="py-3 text-sm text-slate-500">This booking is {status}. There’s nothing left to manage.</p>}
                </div>
            )}

            {view === 'money' && (
                <MoneyView
                    bookingId={bookingId}
                    guestFirst={guestFirst}
                    totalPrice={totalPrice}
                    amountPaid={amountPaid}
                    amountRefunded={amountRefunded}
                    onDone={() => { setOpen(false); }}
                />
            )}

            {view === 'dispute' && (
                <DisputeView bookingId={bookingId} onDone={() => setOpen(false)} />
            )}

            {view === 'cancel' && (
                <div>
                    {isOwner ? (
                        <>
                            <p className="mb-3 text-sm text-slate-600">
                                {status === 'pending'
                                    ? 'Declining sends the guest’s money back and puts the dates back on sale.'
                                    : 'Cancelling refunds the guest in full and puts the dates back on sale. A 5% fee may come off your next payout.'}
                            </p>
                            <BookingActions
                                bookingId={bookingId}
                                mode={status === 'pending' ? 'pending' : 'confirmed'}
                                allowRefund={false}
                                totalPrice={totalPrice}
                                amountPaid={amountPaid}
                                amountRefunded={amountRefunded}
                            />
                        </>
                    ) : (
                        <p className="text-sm text-slate-500">Accepting, cancelling and refunding stay with the owner.</p>
                    )}
                </div>
            )}
        </Modal>
    );
}

function Row({ icon: Icon, label, sub, href, onClick, onNavigate, danger }: {
    icon: any; label: string; sub?: string; href?: string; onClick?: () => void; onNavigate?: () => void; danger?: boolean;
}) {
    const inner = (
        <>
            <Icon className={'h-4 w-4 flex-none ' + (danger ? 'text-rose-500' : 'text-slate-400')} />
            <span className="min-w-0 flex-1">
                <span className={'block text-sm font-semibold ' + (danger ? 'text-rose-700' : 'text-slate-900')}>{label}</span>
                {sub && <span className="block text-[13px] text-slate-500">{sub}</span>}
            </span>
            <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
        </>
    );
    const cls = 'flex w-full items-center gap-3 py-3 text-left';
    if (href) return <Link href={href} onClick={onNavigate} className={cls}>{inner}</Link>;
    return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

function CopyButton({ value }: { value: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* on screen */ } }}
            className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-700 transition hover:border-slate-400"
        >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
        </button>
    );
}

// Send reuses the proven refund path (BookingActions). Request is the new
// notify-only ask — it records a message and emails the guest.
function MoneyView({ bookingId, guestFirst, totalPrice, amountPaid, amountRefunded, onDone }: {
    bookingId: string; guestFirst: string; totalPrice: number; amountPaid: number; amountRefunded: number; onDone: () => void;
}) {
    const router = useRouter();
    const [tab, setTab] = useState<'send' | 'request'>('send');
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState('');
    const refundable = Math.round((Number(amountPaid) - Number(amountRefunded)) * 100) / 100;

    async function request() {
        const value = Math.round(Number(amount) * 100) / 100;
        setError('');
        if (!value || isNaN(value) || value <= 0) { setError('Enter how much to ask for.'); return; }
        if (!reason.trim()) { setError('Say what the money is for.'); return; }
        setBusy(true);
        try {
            const res = await fetch('/api/bookings/request-money', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId, amount: value, reason: reason.trim() }),
            });
            const d = await res.json().catch(() => ({}));
            if (d && d.ok) { setDone('Asked ' + guestFirst + ' for £' + value.toFixed(2) + '. They’ll see it in your messages.'); router.refresh(); }
            else setError((d && d.error) || 'Could not send the request.');
        } catch { setError('Could not send the request.'); }
        setBusy(false);
    }

    if (done) return <p className="text-sm font-medium text-emerald-700">{done}</p>;

    return (
        <div>
            <div className="mb-4 inline-flex rounded-xl border border-slate-200 p-0.5 text-sm">
                {(['send', 'request'] as const).map((t) => (
                    <button key={t} type="button" onClick={() => { setTab(t); setError(''); }}
                        className={'rounded-lg px-3 py-1.5 font-semibold capitalize ' + (tab === t ? 'bg-slate-900 text-white' : 'text-slate-600')}>
                        {t === 'send' ? 'Send money' : 'Request money'}
                    </button>
                ))}
            </div>

            {tab === 'send' ? (
                refundable > 0 ? (
                    <>
                        <p className="mb-3 text-sm text-slate-600">Give some or all of what the guest has paid back to them, keeping the stay on.</p>
                        <BookingActions bookingId={bookingId} mode="confirmed" allowCancel={false} totalPrice={totalPrice} amountPaid={amountPaid} amountRefunded={amountRefunded} />
                    </>
                ) : (
                    <p className="text-sm text-slate-500">There’s nothing to refund — the guest hasn’t paid anything yet.</p>
                )
            ) : (
                <>
                    <p className="mb-3 text-sm text-slate-600">Ask {guestFirst} for a fee, or for money towards a change. They’re notified — nothing is charged automatically.</p>
                    <div className="flex items-center gap-2">
                        <span className="text-slate-500">£</span>
                        <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                            className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900" />
                    </div>
                    <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} placeholder="What it’s for"
                        className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900" />
                    {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
                    <button type="button" disabled={busy} onClick={request}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send request
                    </button>
                </>
            )}
            {tab === 'send' && error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
        </div>
    );
}

function DisputeView({ bookingId, onDone }: { bookingId: string; onDone: () => void }) {
    const [reason, setReason] = useState('');
    const [details, setDetails] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    async function submit() {
        setError('');
        if (!details.trim()) { setError('Tell us what has gone wrong.'); return; }
        setBusy(true);
        try {
            const res = await fetch('/api/bookings/dispute', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId, reason: reason.trim(), details: details.trim() }),
            });
            const d = await res.json().catch(() => ({}));
            if (d && d.ok) setDone(true);
            else setError((d && d.error) || 'Could not raise the dispute.');
        } catch { setError('Could not raise the dispute.'); }
        setBusy(false);
    }

    if (done) return <p className="text-sm font-medium text-emerald-700">Raised. We’ve emailed the team with this booking attached and will be in touch.</p>;

    return (
        <div>
            <p className="mb-3 text-sm text-slate-600">This sends the booking to us to look into — damage, a no-show, a guest you can’t resolve with. It doesn’t charge anyone.</p>
            <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 120))} placeholder="In a few words (e.g. damage, no-show)"
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900" />
            <textarea value={details} onChange={(e) => setDetails(e.target.value.slice(0, 2000))} rows={4} placeholder="What happened?"
                className="mt-2 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900" />
            {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
            <button type="button" disabled={busy} onClick={submit}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Raise dispute
            </button>
        </div>
    );
}
