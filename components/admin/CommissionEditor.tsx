'use client';

// =====================================================================
// GALLOWAY GETAWAYS — commission rate editor
// WHERE THIS GOES: GitHub → components/admin/CommissionEditor.tsx  (NEW FILE)
//
// The body of the old app/admin/commission/page.tsx, minus the gate.
//
// That page used to be a client component that asked the browser whether the
// person looking at it was an owner, and drew the rates if the answer came
// back yes. The page now decides that on the server before this renders, and
// hands the rows down as props — so there is nothing here to be told a lie
// about, and no query for commission_rate leaving the browser.
// =====================================================================

import Link from 'next/link';
import { useState } from 'react';
import { DEFAULT_COMMISSION_PERCENT } from '@/lib/fees';

export interface CommissionRow {
    id: string;
    title: string;
    host_id: string;
    commission_rate: number | null;
}

export default function CommissionEditor({
    rows: initialRows,
    hostNames,
}: {
    rows: CommissionRow[];
    hostNames: Record<string, string>;
}) {
    const [rows, setRows] = useState<CommissionRow[]>(initialRows);
    const [drafts, setDrafts] = useState<Record<string, string>>(() => {
        const initial: Record<string, string> = {};
        initialRows.forEach((l) => {
            initial[l.id] =
                l.commission_rate === null || l.commission_rate === undefined
                    ? ''
                    : String(l.commission_rate);
        });
        return initial;
    });
    const [savingId, setSavingId] = useState<string | null>(null);
    const [message, setMessage] = useState('');

    const save = async (listingId: string) => {
        setSavingId(listingId);
        setMessage('');
        try {
            const res = await fetch('/api/admin/commission', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listingId: listingId, rate: drafts[listingId] }),
            });
            const data = await res.json();

            if (data && data.ok) {
                setRows((prev) =>
                    prev.map((r) => (r.id === listingId ? { ...r, commission_rate: data.rate } : r))
                );
                setMessage('Saved.');
            } else {
                setMessage((data && data.error) || 'Could not save.');
            }
        } catch (err) {
            setMessage('Could not save.');
        }
        setSavingId(null);
    };

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:underline">
                &larr; Owner tools
            </Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-1">Commission rates</h1>
            <p className="text-sm text-slate-500 mb-8">
                Leave a rate blank for the standard {DEFAULT_COMMISSION_PERCENT}%. Hosts never see
                this page or their rate.
            </p>

            {message && (
                <div className="mb-4 text-sm font-medium text-emerald-700">{message}</div>
            )}

            <div className="space-y-3">
                {rows.map((r) => (
                    <div
                        key={r.id}
                        className="border rounded-2xl p-4 flex items-center justify-between gap-4 flex-wrap"
                    >
                        <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">{r.title}</div>
                            <div className="text-sm text-slate-500">
                                {hostNames[r.host_id] || 'Host'}
                                {r.commission_rate === null || r.commission_rate === undefined
                                    ? ' · standard rate'
                                    : ' · ' + r.commission_rate + '%'}
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.5"
                                placeholder={String(DEFAULT_COMMISSION_PERCENT)}
                                value={drafts[r.id] ?? ''}
                                onChange={(e) =>
                                    setDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                                }
                                className="w-24 border rounded-xl px-3 py-2 text-sm outline-none focus:border-slate-900"
                            />
                            <span className="text-sm text-slate-400">%</span>
                            <button
                                type="button"
                                onClick={() => save(r.id)}
                                disabled={savingId === r.id}
                                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50"
                            >
                                {savingId === r.id ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {rows.length === 0 && (
                <p className="text-slate-500">No listings yet.</p>
            )}
        </div>
    );
}
