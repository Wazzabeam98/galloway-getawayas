'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
    Pencil, ChevronRight, ChevronLeft, Phone, Copy, Check, MessageSquare, XCircle, CalendarDays, Loader2, Clock3,
} from 'lucide-react';
import Modal from '@/components/dashboard/reservation/Modal';
import ChangeDateTime from '@/components/marketplace/ChangeDateTime';

// The provider's "Manage reservation" row — the host page's action sheet, for a
// guest-experience order. A pencil opens a pop-up with the actions a provider
// actually has: message the guest, copy their phone (once the booking is
// confirmed), accept or decline a date/time change the guest has asked for, and
// cancel/decline the booking.
//
// It wires the flows that already exist rather than inventing any:
//   * date/time change  — PR #173 is GUEST-initiated; the provider only answers a
//     pending request, so this shows Accept / Decline when one is waiting. There
//     is no provider-initiated propose in that flow.
//   * cancel / decline  — /api/services/orders/respond: 'decline' releases a held
//     request (nothing charged); 'refund' cancels a confirmed booking and refunds
//     the guest in full.

export interface ManageData {
    orderId: string;
    status: string;                 // 'authorised' | 'confirmed' | …
    shape: string;                  // 'slot' | 'comes_to_you' | 'made_to_order'
    phone: string | null;
    guestFirst: string;
    messageHref: string | null;
    pendingChange: string | null;   // "Mon 6 Oct at 2pm" when a change is awaiting an answer
    pendingChangeBy: 'guest' | 'provider' | null;  // who proposed it
}

async function respond(orderId: string, decision: string): Promise<string | null> {
    try {
        const r = await fetch('/api/services/orders/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, decision }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d && d.ok) return null;
        return (d && d.error) || 'That didn’t go through. Try again.';
    } catch {
        return 'That didn’t go through. Try again.';
    }
}

export default function ProviderManageSheet({ data }: { data: ManageData }) {
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<'menu' | 'change'>('menu');
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const confirmed = data.status === 'confirmed';
    const awaiting = data.status === 'authorised';
    const closed = data.status === 'cancelled' || data.status === 'declined' || data.status === 'refunded';
    // A provider can propose a date/time change on the two request shapes (the
    // guest then accepts) — the same scope as PR #173's change-date flow. A slot
    // is moved from the session picker, so it isn't offered here.
    const canPropose = confirmed && !data.pendingChange && (data.shape === 'made_to_order' || data.shape === 'comes_to_you');

    async function act(decision: string, confirmMsg?: string) {
        if (confirmMsg && !window.confirm(confirmMsg)) return;
        setBusy(decision); setError(null);
        const err = await respond(data.orderId, decision);
        if (err) { setError(err); setBusy(null); return; }
        window.location.reload();
    }

    return (
        <Modal
            open={open}
            onOpenChange={(v) => { setOpen(v); if (!v) { setError(null); setView('menu'); } }}
            title={view === 'change' ? 'Request a change of date or time' : 'Manage reservation'}
            trigger={
                <button type="button" className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300">
                    <Pencil className="h-4 w-4 flex-none text-slate-400" />
                    <span className="flex-1 text-sm font-semibold text-slate-900">Manage reservation</span>
                    <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                </button>
            }
        >
            {view === 'change' ? (
                <div>
                    <button type="button" onClick={() => setView('menu')} className="mb-2 inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500 hover:text-slate-800">
                        <ChevronLeft className="h-4 w-4" /> Back
                    </button>
                    <p className="mb-3 text-[13px] text-slate-500">Propose a new date or time. Nothing moves until {data.guestFirst} accepts.</p>
                    <ChangeDateTime
                        inline
                        orderId={data.orderId}
                        shape={data.shape}
                        endpoint="/api/services/order/propose-change"
                        verb="Propose"
                        onDone={() => setOpen(false)}
                    />
                </div>
            ) : (
                <>
                    {error && <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}

                    <div className="-my-1 divide-y divide-slate-100">
                        {data.messageHref && (
                            <Row icon={MessageSquare} label={'Message ' + data.guestFirst} sub="Open the conversation" href={data.messageHref} onNavigate={() => setOpen(false)} />
                        )}

                        {confirmed && data.phone && (
                            <div className="flex items-center gap-3 py-3">
                                <Phone className="h-4 w-4 flex-none text-slate-400" />
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold text-slate-900">Guest&rsquo;s phone</div>
                                    <div className="text-[13px] text-slate-500">{data.phone}</div>
                                </div>
                                <CopyButton value={data.phone} />
                            </div>
                        )}

                        {/* A change the GUEST asked for — the provider accepts or declines. */}
                        {confirmed && data.pendingChange && data.pendingChangeBy === 'guest' && (
                            <div className="py-3">
                                <div className="flex items-center gap-3">
                                    <CalendarDays className="h-4 w-4 flex-none text-slate-400" />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-semibold text-slate-900">Change requested</div>
                                        <div className="text-[13px] text-slate-500">Move to {data.pendingChange}</div>
                                    </div>
                                </div>
                                <div className="mt-2 flex gap-2 pl-7">
                                    <button type="button" disabled={!!busy} onClick={() => act('accept_date')} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                                        {busy === 'accept_date' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Accept
                                    </button>
                                    <button type="button" disabled={!!busy} onClick={() => act('decline_date')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-[13px] font-semibold text-slate-700 hover:border-slate-500 disabled:opacity-60">
                                        Decline
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* A change the PROVIDER proposed — waiting on the guest to answer. */}
                        {confirmed && data.pendingChange && data.pendingChangeBy === 'provider' && (
                            <div className="flex items-center gap-3 py-3">
                                <Clock3 className="h-4 w-4 flex-none text-amber-500" />
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold text-slate-900">Waiting on {data.guestFirst}</div>
                                    <div className="text-[13px] text-slate-500">You proposed moving this to {data.pendingChange}.</div>
                                </div>
                            </div>
                        )}

                        {canPropose && (
                            <Row icon={CalendarDays} label="Request a change of date or time" sub="Propose a new date — the guest accepts" onClick={() => setView('change')} />
                        )}

                        {awaiting && (
                            <Row icon={XCircle} label="Decline request" sub="Send the held payment back — nothing is charged" danger onClick={() => act('decline', 'Decline this request? The guest’s card is released and nothing is charged.')} busy={busy === 'decline'} />
                        )}
                        {confirmed && (
                            <Row icon={XCircle} label="Cancel and refund the guest" sub="Calls the booking off and refunds in full" danger onClick={() => act('refund', 'Cancel this booking and refund the guest in full?')} busy={busy === 'refund'} />
                        )}
                        {closed && <p className="py-3 text-sm text-slate-500">This booking is {data.status}. There&rsquo;s nothing left to manage.</p>}
                    </div>
                </>
            )}
        </Modal>
    );
}

function Row({ icon: Icon, label, sub, href, onClick, onNavigate, danger, busy }: {
    icon: any; label: string; sub?: string; href?: string; onClick?: () => void; onNavigate?: () => void; danger?: boolean; busy?: boolean;
}) {
    const inner = (
        <>
            {busy ? <Loader2 className="h-4 w-4 flex-none animate-spin text-slate-400" /> : <Icon className={'h-4 w-4 flex-none ' + (danger ? 'text-rose-500' : 'text-slate-400')} />}
            <span className="min-w-0 flex-1">
                <span className={'block text-sm font-semibold ' + (danger ? 'text-rose-700' : 'text-slate-900')}>{label}</span>
                {sub && <span className="block text-[13px] text-slate-500">{sub}</span>}
            </span>
            <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
        </>
    );
    const cls = 'flex w-full items-center gap-3 py-3 text-left disabled:opacity-60';
    if (href) return <Link href={href} onClick={onNavigate} className={cls}>{inner}</Link>;
    return <button type="button" onClick={onClick} disabled={busy} className={cls}>{inner}</button>;
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
