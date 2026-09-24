'use client';

import { Wallet, ChevronRight } from 'lucide-react';
import Modal from './Modal';

// The money for a booking, as ONE card: the total and the number of nights,
// nothing more. Tapping it opens the pop-up with the whole picture — what the
// guest paid, what's paid so far and any balance still due, our fee with the
// working, what you get, and when the payout lands.
//
// All figures are computed server-side (the same helpers the payout run uses)
// and passed in formatted; this is a presentational shell so no money maths
// lives in the browser.

export interface MoneyDetailRow { label: string; value: string; muted?: boolean }

export interface MoneyCardsData {
    showMoney: boolean;
    total: string;          // "£480.00" — the headline on the card
    nightsLabel: string;    // "Total for 3 nights"
    working?: string;       // "Guest paid £480.00 − our 10% fee £48.00 = £432.00"
    rows: MoneyDetailRow[]; // the full breakdown, shown in the pop-up
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
        <Modal
            title="Money"
            description="What the guest paid, our fee, and when you’re paid."
            trigger={
                <button type="button" className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300">
                    <span className="min-w-0 text-base font-semibold text-slate-900">
                        {props.total}
                        <span className="ml-1.5 text-[13px] font-normal text-slate-500">· {props.nightsLabel}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                </button>
            }
        >
            <Rows rows={props.rows} />
            {props.working && <p className="mt-3 text-[13px] leading-snug text-slate-500">{props.working}</p>}
        </Modal>
    );
}
