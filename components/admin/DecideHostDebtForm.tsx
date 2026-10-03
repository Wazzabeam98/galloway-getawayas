'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { formatGBP } from '@/lib/formatMoney';
import { decisionProblem, type DebtOutcome } from '@/lib/hostDebtView';

// The decision box on one disputed host debt — the same shape as
// ResolveResolutionForm beside it, and the same rule as the route
// (decisionProblem). Upheld or reduced, it is owed again and comes off the
// host's payouts or is paid by them; waived, it is written off.
const OUTCOMES: { value: DebtOutcome; label: string; blurb: string }[] = [
    { value: 'upheld', label: 'It stands', blurb: 'The host owes it in full. It is taken from payouts again.' },
    { value: 'reduced', label: 'Reduce it', blurb: 'The host owes less. Say how much is still owed.' },
    { value: 'waived', label: 'Write it off', blurb: 'The host owes nothing. The platform bears it.' },
];

export default function DecideHostDebtForm({ payoutId, outstanding }: { payoutId: string; outstanding: number }) {
    const router = useRouter();
    const [outcome, setOutcome] = useState<DebtOutcome | ''>('');
    const [keep, setKeep] = useState('');
    const [note, setNote] = useState('');
    const [working, setWorking] = useState(false);

    const submit = async () => {
        const problem = decisionProblem(outcome, keep, outstanding, note);
        if (problem) { toast.error(problem); return; }
        setWorking(true);
        try {
            const res = await fetch('/api/admin/host-debts/decide', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ payoutId, outcome, keep: outcome === 'reduced' ? Number(keep) : null, note: note.trim() }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) { toast.error(body?.error || 'Could not save that.'); setWorking(false); return; }
            toast.success('Decided. The host has been told.');
            router.refresh();
        } catch {
            toast.error('Something went wrong. Try again.');
            setWorking(false);
        }
    };

    return (
        <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-900 mb-2">Decide</div>
            <div className="grid gap-2 sm:grid-cols-3">
                {OUTCOMES.map((o) => (
                    <label key={o.value}
                        className={'flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm '
                            + (outcome === o.value ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 hover:border-slate-300')}>
                        <input type="radio" name={'debt-outcome-' + payoutId} value={o.value}
                            checked={outcome === o.value} onChange={() => setOutcome(o.value)} className="mt-1" />
                        <span>
                            <span className="block font-semibold text-slate-900">{o.label}</span>
                            <span className="block text-[12px] text-slate-500">{o.blurb}</span>
                        </span>
                    </label>
                ))}
            </div>
            {outcome === 'reduced' && (
                <label className="mt-3 block text-sm">
                    <span className="text-slate-700">Still owed (less than {formatGBP(outstanding)})</span>
                    <span className="mt-1 flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-2">
                        £<input type="number" min={0} step="0.01" value={keep} onChange={(e) => setKeep(e.target.value)}
                            className="w-full bg-transparent outline-none" />
                    </span>
                </label>
            )}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                placeholder="What you decided and why — the host is sent this."
                className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-sm" />
            <button type="button" disabled={working} onClick={submit}
                className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
                {working ? 'Saving…' : 'Record decision'}
            </button>
        </div>
    );
}
