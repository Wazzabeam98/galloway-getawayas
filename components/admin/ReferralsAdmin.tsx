'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ukDate } from '@/lib/dayKey';
import type { ReferralStatus } from '@/lib/referrals';

export interface AdminReferralRow {
    id: string;
    referrerName: string;
    referredName: string;
    status: ReferralStatus;
    rewardAmount: number | null;
    waivedCommission: number | null;
    rewardDueAt: string | null;
    rewardPaidAt: string | null;
    createdAt: string;
}

function statusText(status: ReferralStatus): { text: string; tone: string } {
    switch (status) {
        case 'invited':
            return { text: 'Invited', tone: 'bg-slate-100 text-slate-600' };
        case 'listed':
            return { text: 'Listed', tone: 'bg-sky-100 text-sky-800' };
        case 'first_stay_done':
            return { text: 'Reward due', tone: 'bg-amber-100 text-amber-800' };
        case 'reward_paid':
            return { text: 'Paid', tone: 'bg-emerald-100 text-emerald-800' };
        default:
            return { text: status, tone: 'bg-slate-100 text-slate-600' };
    }
}

function money(n: number | null): string {
    return n === null || n === undefined ? '—' : '£' + Number(n).toFixed(2);
}

export default function ReferralsAdmin({ rows: initial }: { rows: AdminReferralRow[] }) {
    const [rows, setRows] = useState<AdminReferralRow[]>(initial);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [message, setMessage] = useState('');

    const markPaid = async (id: string) => {
        setSavingId(id);
        setMessage('');
        try {
            const res = await fetch('/api/admin/referrals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ referralId: id }),
            });
            const data = await res.json();
            if (data && data.ok) {
                setRows((prev) =>
                    prev.map((r) =>
                        r.id === id ? { ...r, status: 'reward_paid', rewardPaidAt: data.rewardPaidAt } : r
                    )
                );
                setMessage('Marked paid.');
            } else {
                setMessage((data && data.error) || 'Could not mark paid.');
            }
        } catch {
            setMessage('Could not mark paid.');
        }
        setSavingId(null);
    };

    const due = rows.filter((r) => r.status === 'first_stay_done');

    return (
        <div className="max-w-4xl mx-auto px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:underline">
                &larr; Owner tools
            </Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-1">Referrals</h1>
            <p className="text-sm text-slate-500 mb-6">
                Rewards are paid by bank transfer. When you’ve sent one, press <strong>Mark paid</strong>.
                {due.length > 0 && (
                    <> There {due.length === 1 ? 'is' : 'are'} <strong>{due.length}</strong> reward{due.length === 1 ? '' : 's'} due.</>
                )}
            </p>

            {message && <div className="mb-4 text-sm font-medium text-emerald-700">{message}</div>}

            {rows.length === 0 ? (
                <p className="text-slate-500">No referrals yet.</p>
            ) : (
                <div className="space-y-3">
                    {rows.map((r) => {
                        const s = statusText(r.status);
                        return (
                            <div
                                key={r.id}
                                className="border rounded-2xl p-4 flex items-center justify-between gap-4 flex-wrap"
                            >
                                <div className="min-w-0">
                                    <div className="font-semibold text-slate-900">
                                        {r.referrerName}{' '}
                                        <span className="font-normal text-slate-400">referred</span>{' '}
                                        {r.referredName}
                                    </div>
                                    <div className="text-sm text-slate-500">
                                        Referred {ukDate(r.createdAt)}
                                        {r.status === 'first_stay_done' || r.status === 'reward_paid' ? (
                                            <>
                                                {' · reward '}{money(r.rewardAmount)}
                                                {r.waivedCommission !== null && r.waivedCommission !== undefined && (
                                                    <> · commission waived {money(r.waivedCommission)}</>
                                                )}
                                                {r.rewardPaidAt && <> · paid {ukDate(r.rewardPaidAt)}</>}
                                            </>
                                        ) : null}
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <span className={'rounded-full px-3 py-1 text-xs font-semibold ' + s.tone}>
                                        {s.text}
                                    </span>
                                    {r.status === 'first_stay_done' && (
                                        <button
                                            type="button"
                                            onClick={() => markPaid(r.id)}
                                            disabled={savingId === r.id}
                                            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50"
                                        >
                                            {savingId === r.id ? 'Saving…' : 'Mark paid'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
