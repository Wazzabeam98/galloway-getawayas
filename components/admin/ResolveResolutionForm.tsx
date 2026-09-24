'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { ADMIN_OUTCOMES } from '@/lib/adminResolutions';

// The decision box on one escalated money request. The note is the point:
// nothing closes without one, because a closed dispute must always say why.
// This records a finding and closes the row — it moves no money.
export default function ResolveResolutionForm({ resolutionId }: { resolutionId: string }) {
    const router = useRouter();
    const [outcome, setOutcome] = useState<string>('');
    const [note, setNote] = useState('');
    const [working, setWorking] = useState(false);

    const submit = async () => {
        if (!outcome) { toast.error('Choose an outcome.'); return; }
        if (!note.trim()) { toast.error('Add a note saying why.'); return; }
        setWorking(true);
        try {
            const res = await fetch('/api/admin/resolutions/resolve', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ resolutionId, outcome, note: note.trim() }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) { toast.error(body?.error || 'Could not resolve that.'); setWorking(false); return; }
            toast.success('Closed. Both sides have been told.');
            router.refresh();
        } catch {
            toast.error('Something went wrong. Try again.');
            setWorking(false);
        }
    };

    return (
        <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-900 mb-2">Resolve</div>
            <div className="grid gap-2 sm:grid-cols-2">
                {ADMIN_OUTCOMES.map((o) => (
                    <label key={o.value}
                        className={'flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm '
                            + (outcome === o.value ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 hover:border-slate-300')}>
                        <input type="radio" name={'outcome-' + resolutionId} value={o.value}
                            checked={outcome === o.value} onChange={() => setOutcome(o.value)} className="mt-1" />
                        <span>
                            <span className="block font-semibold text-slate-900">{o.label}</span>
                            <span className="block text-[12px] text-slate-500">{o.blurb}</span>
                        </span>
                    </label>
                ))}
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                placeholder="What you decided and why — this is the record."
                className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-sm" />
            <button type="button" disabled={working} onClick={submit}
                className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
                {working ? 'Closing…' : 'Record decision & close'}
            </button>
            <p className="mt-2 text-[12px] text-slate-500">
                This records the decision and tells both sides. It moves no money — a request the
                guest never paid has nothing to refund; a refund of something already paid goes
                through Send money.
            </p>
        </div>
    );
}
