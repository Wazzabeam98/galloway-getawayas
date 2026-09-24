'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
    Pencil, ChevronRight, ChevronLeft, Banknote,
    Phone, Copy, Check, MessageSquare, XCircle, CalendarDays,
} from 'lucide-react';
import Modal from './Modal';
import BookingActions from '@/components/BookingActions';
import ResolutionFlow from './ResolutionFlow';
import ChangeReservationFlow from './ChangeReservationFlow';

type View = 'menu' | 'resolution' | 'cancel' | 'change';

// The single "Manage reservation" row — a pencil that opens Airbnb's kind of
// action sheet. It gathers the host actions that are built: send or request money
// (the Resolution Centre — refunds, extra services, damage), the guest's phone
// with a copy button, ask the guest to cancel, and cancel the booking. Change
// reservation and disputes are surfaced separately once built. Cancellation
// reuses the existing BookingActions component.
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
    askToCancelHref,
    checkIn,
    checkOut,
    adults,
    children,
    pets,
    maxGuests,
    petsAllowed,
}: {
    bookingId: string;
    status: string;
    isOwner: boolean;
    ended: boolean;
    started?: boolean;
    phone: string | null;
    guestFirst: string;
    totalPrice: number;
    amountPaid: number;
    amountRefunded: number;
    askToCancelHref: string | null;
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    pets: number;
    maxGuests: number;
    petsAllowed: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<View>('menu');
    const closed = status === 'cancelled' || status === 'declined';
    const refundable = Math.round((Number(amountPaid) - Number(amountRefunded)) * 100) / 100;
    // Changes run right up to check-out — including mid-stay extensions and
    // extra guests. Once the stay is over it's a money matter, so the host uses
    // "Send or request money" (still shown below) instead.
    const canChange = isOwner && !closed && !ended;

    const title = view === 'resolution' ? 'Send or request money'
        : view === 'cancel' ? 'Cancel booking'
        : view === 'change' ? 'Change reservation'
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
                    {canChange && (
                        <Row icon={CalendarDays} label="Change reservation" sub="New dates, guests or price — the guest confirms" onClick={() => setView('change')} />
                    )}
                    {isOwner && !closed && (
                        <Row icon={Banknote} label="Send or request money" sub="For a refund, extra services or damage" onClick={() => setView('resolution')} />
                    )}
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

            {view === 'change' && (
                <ChangeReservationFlow
                    bookingId={bookingId}
                    role="host"
                    counterpartyName={guestFirst}
                    checkIn={checkIn}
                    checkOut={checkOut}
                    adults={adults}
                    childrenCount={children}
                    pets={pets}
                    maxGuests={maxGuests}
                    petsAllowed={petsAllowed}
                    onClose={() => { setOpen(false); setView('menu'); }}
                />
            )}

            {view === 'resolution' && (
                <ResolutionFlow
                    bookingId={bookingId}
                    guestFirst={guestFirst}
                    afterCheckout={ended}
                    netPaid={refundable}
                    onClose={() => { setOpen(false); setView('menu'); }}
                />
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
