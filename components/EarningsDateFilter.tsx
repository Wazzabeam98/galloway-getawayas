'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { SlidersHorizontal } from 'lucide-react';

export default function EarningsDateFilter({ from, to }: { from: string; to: string }) {
    const router = useRouter();
    const params = useSearchParams();

    const update = (key: 'from' | 'to', value: string) => {
        const sp = new URLSearchParams(params?.toString());
        sp.set(key, value);
        router.push(`/dashboard/earnings?${sp.toString()}`);
    };

    return (
        <div className="flex items-center gap-2 border rounded-xl px-3 py-2 bg-white flex-wrap">
            <SlidersHorizontal className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <input
                type="date"
                value={from}
                onChange={(e) => update('from', e.target.value)}
                className="text-sm outline-none bg-transparent"
            />
            <span className="text-slate-400 text-sm">to</span>
            <input
                type="date"
                value={to}
                onChange={(e) => update('to', e.target.value)}
                className="text-sm outline-none bg-transparent"
            />
        </div>
    );
}
