'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HotelDecider({ id }: { id: string }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function decide(decision: 'approve' | 'decline') {
        setBusy(true); setError(null);
        try {
            const res = await fetch('/api/admin/hotels/decide', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, decision }),
            });
            const body = await res.json().catch(() => ({}));
            if (!body.ok) { setError(body.error || 'Could not do that.'); setBusy(false); return; }
            router.refresh();
        } catch {
            setError('Something went wrong.');
            setBusy(false);
        }
    }

    return (
        <div className="shrink-0 text-right">
            <div className="flex gap-2">
                <button type="button" onClick={() => decide('approve')} disabled={busy}
                    className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">Approve</button>
                <button type="button" onClick={() => decide('decline')} disabled={busy}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">Decline</button>
            </div>
            {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
        </div>
    );
}
