'use client';

import { ShieldCheck, ChevronRight } from 'lucide-react';
import Modal from '@/components/dashboard/reservation/Modal';

// The provider's OWN cancellation terms, in the host page's policy-card style —
// a small card showing the headline, tapping opens the detail in a pop-up. A
// provider doesn't use the holiday-let's four tiers; they set a single notice
// window (or "no refunds"), and the meaning is shape-aware (a class counts hours
// before the session; a chef or bakery order counts from the day). All the
// wording is computed server-side and passed in, so this stays presentational.
export interface CancellationCardData {
    headline: string;   // "Free up to 2 days before" / "No refunds"
    summary: string;    // the full sentence, the guest's view
    lateLine: string;   // what happens if they cancel late
}

export default function ProviderCancellationCard({ data }: { data: CancellationCardData }) {
    return (
        <Modal
            title="Your cancellation terms"
            description="What a guest is told, and what happens if they cancel late."
            trigger={
                <button type="button" className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300">
                    <ShieldCheck className="h-4 w-4 flex-none text-slate-400" />
                    <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Cancellation</span>
                        <span className="mt-0.5 block text-sm font-semibold text-slate-900">{data.headline}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                </button>
            }
        >
            <p className="text-sm text-slate-700">{data.summary}</p>
            <p className="mt-3 text-sm text-slate-600">{data.lateLine}</p>
            <p className="mt-4 text-[13px] text-slate-500">
                You can change your notice period, or turn refunds off, in your listing settings.
            </p>
        </Modal>
    );
}
