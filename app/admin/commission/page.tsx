'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { DEFAULT_COMMISSION_PERCENT } from '@/lib/fees';
import { displayName } from '@/lib/utils';

interface Row {
    id: string;
    title: string;
    host_id: string;
    commission_rate: number | null;
}

export default function CommissionAdmin() {
    const supabase = createClientComponentClient();
    const [loading, setLoading] = useState(true);
    const [allowed, setAllowed] = useState(false);
    const [rows, setRows] = useState<Row[]>([]);
    const [hostNames, setHostNames] = useState<Record<string, string>>({});
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [savingId, setSavingId] = useState<string | null>(null);
    const [message, setMessage] = useState('');

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session || !session.user) {
                setLoading(false);
                return;
            }

            const { data: me } = await supabase
                .from('profiles')
                .select('is_admin')
                .eq('id', session.user.id)
                .maybeSingle();

            if (!me || !me.is_admin) {
                setLoading(false);
                return;
            }
            setAllowed(true);

            const { data: listings } = await supabase
                .from('listings')
                .select('id, title, host_id, commission_rate')
                .order('title');

            setRows(listings || []);

            const initial: Record<string, string> = {};
            (listings || []).forEach((l: Row) => {
                initial[l.id] = l.commission_rate === null || l.commission_rate === undefined
                    ? ''
                    : String(l.commission_rate);
            });
            setDrafts(initial);

            const hostIds = Array.from(new Set((listings || []).map((l: Row) => l.host_id)));
            if (hostIds.length) {
                const { data: hosts } = await supabase
                    .from('profiles')
                    .select('id, full_name, preferred_name, show_full_name')
                    .in('id', hostIds);
                const names: Record<string, string> = {};
                (hosts || []).forEach((h: any) => {
                    names[h.id] = displayName(h, 'Host');
                });
                setHostNames(names);
            }

            setLoading(false);
        };

        load();
    }, []);

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

    if (loading) {
        return <div className="max-w-3xl mx-auto px-6 py-10 text-slate-400">Loading…</div>;
    }

    if (!allowed) {
        return (
            <div className="max-w-3xl mx-auto px-6 py-20 text-center">
                <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
                <p className="text-slate-500 mt-1">This page isn&apos;t available.</p>
            </div>
        );
    }

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
