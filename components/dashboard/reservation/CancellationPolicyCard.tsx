'use client';

import { ShieldCheck, ChevronRight } from 'lucide-react';
import Modal from './Modal';
import { CANCELLATION_TIERS } from '@/lib/cancellationTiers';

// A small card showing just the policy's NAME (Flexible / Moderate / Limited /
// Firm). Tapping it opens the full policy in the page's pop-up, with this
// booking's tier called out. The name and summary are computed server-side
// (cancellationWords) and passed in, so this stays a thin presentational shell.
export default function CancellationPolicyCard({ tier, summary }: { tier: string; summary: string }) {
    return (
        <Modal
            title="Cancellation policy"
            description="The four tiers a host can choose. This booking’s is highlighted."
            trigger={
                <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300"
                >
                    <ShieldCheck className="h-4 w-4 flex-none text-slate-400" />
                    <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Cancellation policy</span>
                        <span className="mt-0.5 block text-sm font-semibold text-slate-900">{tier}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                </button>
            }
        >
            <p className="text-sm text-slate-600">{summary}</p>
            <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {CANCELLATION_TIERS.map((t) => {
                    const active = t.name === tier;
                    return (
                        <div key={t.name} className={'p-4 ' + (active ? 'bg-emerald-50/60' : '')}>
                            <div className="flex items-center gap-2">
                                <span className={'text-sm font-semibold ' + (active ? 'text-emerald-800' : 'text-slate-900')}>{t.name}</span>
                                {active && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">This booking</span>}
                            </div>
                            <ul className="mt-1 space-y-0.5 text-[13px] text-slate-600">
                                <li>{t.full}</li>
                                <li>{t.partial}</li>
                            </ul>
                        </div>
                    );
                })}
            </div>
            <p className="mt-4 text-[13px] text-slate-500">
                Cleaning fees are always refunded in full. If a host cancels a confirmed booking, the guest is refunded in full including all fees.
            </p>
            <a href="/cancellation-policy" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-[13px] font-medium text-emerald-700 underline hover:text-emerald-800">
                Read the full policy
            </a>
        </Modal>
    );
}
