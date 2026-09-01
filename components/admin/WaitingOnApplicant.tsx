'use client';

import { useState } from 'react';
import { RETENTION_DAYS } from '@/lib/serviceApplications';

export interface WaitingRow {
    id: string;
    business_name: string;
    trade: string;
    email: string;
    contact_phone: string | null;
    daysWaiting: number;
    daysLeft: number;
    resend_count: number;
}

// The people who filled the form in and never opened their link.
//
// They have no account and nothing in the review queue, so without this they
// appear on no screen at all — which is the same as losing them, and losing
// them is the thing the whole flow was reorganised to stop.
//
// The phone is the second column and it dials. Chasing a tradesman means
// ringing him; the address is the one he has already failed to open.
export default function WaitingOnApplicant({ rows }: { rows: WaitingRow[] }) {
    const [sent, setSent] = useState<Record<string, boolean>>({});
    const [busy, setBusy] = useState<Record<string, boolean>>({});

    const resend = async (id: string) => {
        setBusy((b) => ({ ...b, [id]: true }));
        try {
            await fetch('/api/services/resend-verification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ applicationId: id }),
            });
            setSent((sn) => ({ ...sn, [id]: true }));
        } finally {
            setBusy((b) => ({ ...b, [id]: false }));
        }
    };

    if (!rows.length) return null;

    return (
        <section className="mb-10">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Waiting on the applicant</h2>
            <p className="text-sm text-slate-500 mb-4 max-w-2xl">
                They filled the form in but have not opened their link, so there is no account and
                nothing in the review queue yet. Ring them — that is what this list is for.
            </p>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-sm min-w-[36rem]">
                    <thead>
                        <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                            <th className="py-2.5 px-4 font-medium">Business</th>
                            <th className="py-2.5 px-4 font-medium">Phone</th>
                            <th className="py-2.5 px-4 font-medium">Applied</th>
                            <th className="py-2.5 px-4 font-medium">Links sent</th>
                            <th className="py-2.5 px-4 font-medium"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => {
                            const urgent = r.daysLeft <= 21;
                            return (
                                <tr key={r.id} className="border-b border-slate-100 last:border-0 align-top">
                                    <td className="py-3 px-4">
                                        <div className="font-semibold text-slate-900">{r.business_name}</div>
                                        <div className="text-xs text-slate-500">
                                            {r.trade} · {r.email}
                                        </div>
                                    </td>
                                    <td className="py-3 px-4 whitespace-nowrap">
                                        {r.contact_phone ? (
                                            <a
                                                href={`tel:${r.contact_phone.replace(/\s+/g, '')}`}
                                                className="font-semibold text-emerald-800 hover:underline"
                                            >
                                                {r.contact_phone}
                                            </a>
                                        ) : (
                                            <span className="text-slate-400">no number</span>
                                        )}
                                    </td>
                                    <td className="py-3 px-4 whitespace-nowrap tabular-nums">
                                        <span
                                            className={
                                                'text-xs font-semibold px-2 py-0.5 rounded-full border ' +
                                                (urgent
                                                    ? 'border-red-200 bg-red-50 text-red-800'
                                                    : r.daysWaiting >= 7
                                                        ? 'border-amber-200 bg-amber-50 text-amber-900'
                                                        : 'border-emerald-200 bg-emerald-50 text-emerald-800')
                                            }
                                        >
                                            {r.daysWaiting === 0
                                                ? 'today'
                                                : `${r.daysWaiting} day${r.daysWaiting === 1 ? '' : 's'} ago`}
                                        </span>
                                        {urgent && (
                                            <div className="text-xs text-red-700 mt-1">
                                                deleted in {r.daysLeft > 0 ? r.daysLeft : 0}
                                            </div>
                                        )}
                                    </td>
                                    <td className="py-3 px-4 tabular-nums text-slate-600">
                                        {r.resend_count + 1}
                                    </td>
                                    <td className="py-3 px-4 whitespace-nowrap">
                                        {sent[r.id] ? (
                                            <span className="text-emerald-800 font-medium">Sent</span>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => resend(r.id)}
                                                disabled={busy[r.id]}
                                                className="text-emerald-800 font-medium hover:underline disabled:opacity-50"
                                            >
                                                {busy[r.id] ? 'Sending…' : 'Send another link'}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <p className="text-xs text-slate-400 mt-2">
                Applications are deleted {RETENTION_DAYS} days after they are sent if the link is
                never opened.
            </p>
        </section>
    );
}
