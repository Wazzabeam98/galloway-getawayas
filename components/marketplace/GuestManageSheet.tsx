'use client';

import { useState } from 'react';
import { Pencil, ChevronRight, ChevronLeft, CalendarDays } from 'lucide-react';
import Modal from '@/components/dashboard/reservation/Modal';
import ChangeDateTime from '@/components/marketplace/ChangeDateTime';
import ChangeGuestCount from '@/components/marketplace/ChangeGuestCount';
import OrderCancel from '@/components/marketplace/OrderCancel';
import ProviderProposalBanner from '@/components/marketplace/ProviderProposalBanner';

// The guest's "Manage reservation" row — the mirror of ProviderManageSheet, so a
// guest can change or cancel their experience from the messages pane without
// leaving. It invents no flows: it reuses the exact components the order page
// offers a guest (ChangeGuestCount / ChangeDateTime / OrderCancel, plus the
// provider-proposal accept/decline banner), which each self-fetch. Which of them
// appears is decided by the route (the same gating as the order page), so a guest
// only ever sees the actions they actually have.

export interface GuestManageData {
    orderId: string;
    shape: string;
    status: string;
    charged: boolean;
    free: boolean;
    price: number;
    providerName: string;
    live: boolean;
    canChangeCount: boolean;
    canChangeDate: boolean;
    providerProposal: string | null;   // "Mon 6 Oct at 2pm" when the provider has proposed a move
}

const ROW = 'flex w-full items-center justify-between gap-3 py-3 text-left text-sm font-medium text-slate-800 hover:text-slate-950';

export default function GuestManageSheet({ data }: { data: GuestManageData }) {
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<'menu' | 'change'>('menu');

    const nothing = !data.providerProposal && !data.canChangeCount && !data.canChangeDate && !data.live;

    return (
        <Modal
            open={open}
            onOpenChange={(v) => { setOpen(v); if (!v) setView('menu'); }}
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
                    <p className="mb-3 text-[13px] text-slate-500">Ask {data.providerName} for a new date or time. Nothing moves until they accept.</p>
                    <ChangeDateTime inline orderId={data.orderId} shape={data.shape} onDone={() => setOpen(false)} />
                </div>
            ) : (
                <div className="-my-1 divide-y divide-slate-100">
                    {/* A move the PROVIDER proposed — the guest accepts or declines. */}
                    {data.providerProposal && (
                        <div className="py-3">
                            <ProviderProposalBanner orderId={data.orderId} whenLabel={data.providerProposal} businessName={data.providerName} />
                        </div>
                    )}

                    {data.canChangeCount && (
                        <ChangeGuestCount orderId={data.orderId} shape={data.shape} className={ROW} />
                    )}

                    {data.canChangeDate && (
                        <button type="button" onClick={() => setView('change')} className={ROW}>
                            <span className="flex items-center gap-3">
                                <CalendarDays className="h-4 w-4 flex-none text-slate-400" />
                                <span>Request a change of date or time</span>
                            </span>
                            <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                        </button>
                    )}

                    {data.live && (
                        <OrderCancel
                            orderId={data.orderId}
                            status={data.status}
                            charged={data.charged}
                            free={data.free}
                            price={data.price}
                            providerName={data.providerName}
                            className={ROW}
                            panelClassName="pb-3"
                        />
                    )}

                    {nothing && <p className="py-3 text-sm text-slate-500">This booking is {data.status}. There&rsquo;s nothing left to manage.</p>}
                </div>
            )}
        </Modal>
    );
}
