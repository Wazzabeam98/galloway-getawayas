'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CATEGORY_LABEL, REGION_LABEL } from '@/lib/interest';

export interface InterestRow {
    id: string;
    created_at: string;
    updated_at: string;
    category: string;
    name: string;
    email: string;
    phone: string | null;
    region: string | null;
    notes: string | null;
    property_count: number | null;
    status: string;
}

const STATUS_FLOW = ['new', 'contacted', 'opened', 'dismissed'] as const;
const STATUS_STYLE: Record<string, string> = {
    new: 'bg-emerald-100 text-emerald-800',
    contacted: 'bg-sky-100 text-sky-800',
    opened: 'bg-violet-100 text-violet-800',
    dismissed: 'bg-slate-200 text-slate-600',
};

type SortKey = 'created_at' | 'category' | 'name' | 'region' | 'status';

export default function InterestTable({ rows }: { rows: InterestRow[] }) {
    const router = useRouter();
    const [sortKey, setSortKey] = useState<SortKey>('created_at');
    const [asc, setAsc] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);

    const sorted = useMemo(() => {
        const copy = [...rows];
        copy.sort((a, b) => {
            const av = (a[sortKey] || '') as string;
            const bv = (b[sortKey] || '') as string;
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return asc ? cmp : -cmp;
        });
        return copy;
    }, [rows, sortKey, asc]);

    function toggleSort(key: SortKey) {
        if (key === sortKey) setAsc((v) => !v);
        else { setSortKey(key); setAsc(key === 'name' || key === 'region'); }
    }

    async function setStatus(id: string, status: string) {
        setBusy(id);
        try {
            const res = await fetch('/api/admin/interest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status }),
            });
            if (res.ok) router.refresh();
        } finally {
            setBusy(null);
        }
    }

    if (rows.length === 0) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-slate-500">
                No registrations yet.
            </div>
        );
    }

    const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
        <th className="px-3 py-2 text-left">
            <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:text-slate-900">
                {children}
                {sortKey === k && <span className="text-slate-400">{asc ? '▲' : '▼'}</span>}
            </button>
        </th>
    );

    return (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                    <tr>
                        <Th k="created_at">Registered</Th>
                        <Th k="category">Interested in</Th>
                        <Th k="name">Name</Th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Contact</th>
                        <Th k="region">Area</Th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Properties / notes</th>
                        <Th k="status">Status</Th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Mark</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                    {sorted.map((r) => (
                        <tr key={r.id} className="align-top">
                            <td className="whitespace-nowrap px-3 py-3 text-slate-500">
                                {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-slate-800">
                                {CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] || r.category}
                            </td>
                            <td className="px-3 py-3 font-medium text-slate-900">{r.name}</td>
                            <td className="px-3 py-3 text-slate-600">
                                <a href={`mailto:${r.email}`} className="text-emerald-700 hover:underline">{r.email}</a>
                                {r.phone && <div className="text-slate-500">{r.phone}</div>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                                {r.region ? (REGION_LABEL[r.region] || r.region) : '—'}
                            </td>
                            <td className="max-w-xs px-3 py-3 text-slate-600">
                                {r.category === 'holiday_let'
                                    ? (r.property_count ? r.property_count + (r.property_count === 1 ? ' property' : ' properties') : '—')
                                    : (r.notes || '—')}
                            </td>
                            <td className="px-3 py-3">
                                <span className={'inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ' + (STATUS_STYLE[r.status] || 'bg-slate-100 text-slate-600')}>
                                    {r.status}
                                </span>
                            </td>
                            <td className="px-3 py-3">
                                <div className="flex flex-wrap gap-1">
                                    {STATUS_FLOW.filter((s) => s !== r.status).map((s) => (
                                        <button
                                            key={s}
                                            type="button"
                                            disabled={busy === r.id}
                                            onClick={() => setStatus(r.id, s)}
                                            className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
