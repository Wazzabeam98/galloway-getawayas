'use client';

import { Wallet, ChevronRight } from 'lucide-react';
import Modal from './Modal';

// The Money and Payment sections merged into three compact cards — You get,
// Paid so far, Payout — each showing only its headline figure and opening the
// full breakdown in the page's pop-up. Every number that used to be listed
// twice now lives in exactly one place: the fee breakdown behind "You get", the
// payment stage behind "Paid so far", the payout reasoning behind "Payout".
//
// All figures are computed server-side (the same helpers the payout run uses)
// and passed in formatted; this is a presentational shell so no money maths
// lives in the browser.

export interface MoneyDetailRow { label: string; value: string; muted?: boolean }

export interface MoneyCardsData {
    showMoney: boolean;
    // Headline figures for the three cards.
    youGet: string;
    // The working behind "You get", shown on the card itself — e.g.
    // "Guest paid £480 − our 10% fee £48 = £432" — using the booking's stamped
    // commission rate. Reconciles exactly to youGet.
    youGetWorking?: string;
    paidSoFar: string;
    ofTotal: string;
    payoutHeadline: string;
    // Detail rows for each card's pop-up.
    earningRows: MoneyDetailRow[];
    paymentRows: MoneyDetailRow[];
    payoutRows: MoneyDetailRow[];
}

function Rows({ rows }: { rows: MoneyDetailRow[] }) {
    return (
        <div>
            {rows.map((r, i) => (
                <div key={i} className="flex items-baseline justify-between gap-6 border-b border-slate-100 py-2 last:border-0">
                    <div className="text-sm text-slate-500">{r.label}</div>
                    <div className={'text-right text-sm ' + (r.muted ? 'text-slate-500' : 'font-medium text-slate-900')}>{r.value}</div>
                </div>
            ))}
        </div>
    );
}

function StatCard({ label, value, sub, working, title, description, rows }: {
    label: string; value: string; sub?: string; working?: string; title: string; description?: string; rows: MoneyDetailRow[];
}) {
    return (
        <Modal
            title={title}
            description={description}
            trigger={
                <button type="button" className="flex w-full flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300">
                    <span className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
                        <ChevronRight className="h-4 w-4 text-slate-300" />
                    </span>
                    <span className="mt-1 text-lg font-semibold text-slate-900">{value}</span>
                    {working && <span className="mt-0.5 text-[13px] leading-snug text-slate-500">{working}</span>}
                    {sub && <span className="text-[13px] text-slate-500">{sub}</span>}
                </button>
            }
        >
            <Rows rows={rows} />
        </Modal>
    );
}

export default function MoneyCards(props: MoneyCardsData) {
    if (!props.showMoney) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2 text-slate-900">
                    <Wallet className="h-4 w-4 flex-none text-slate-400" />
                    <span className="text-sm font-semibold">Money</span>
                </div>
                <p className="mt-2 text-sm text-slate-500">
                    You look after this booking but not its takings, so the figures are hidden. The owner can change that under Co-hosts.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* "You get" runs full width so the working — Guest paid − our fee =
                what you get — sits on one line rather than being squeezed into a
                third of the column. */}
            <StatCard
                label="You get"
                value={props.youGet}
                working={props.youGetWorking}
                title="What you’ll be paid"
                description="From the guest’s total, after our fee and anything owed."
                rows={props.earningRows}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StatCard
                    label="Paid so far"
                    value={props.paidSoFar}
                    sub={props.ofTotal}
                    title="Payment"
                    description="How the guest is paying, and where cancellation stands."
                    rows={props.paymentRows}
                />
                <StatCard
                    label="Payout"
                    value={props.payoutHeadline}
                    title="Your payout"
                    description="When the money reaches your bank."
                    rows={props.payoutRows}
                />
            </div>
        </div>
    );
}
