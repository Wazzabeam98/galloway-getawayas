'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { skillCompact } from '@/lib/serviceSkills';

const CONCEPTS = [
    { key: '', label: 'Not regulated' },
    { key: 'gas', label: 'Gas Safe' },
    { key: 'oil', label: 'OFTEC' },
    { key: 'electrical', label: 'Part P' },
];

// Pick the one to keep, then the ones to fold into it.
//
// Two directions were possible and this is the safer one: choosing the winner
// first means the destructive-looking half of the sentence is read last, and
// an accidental click adds a loser to a list rather than performing a merge.
export default function SkillMergeTool({ skills }: { skills: any[] }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [keep, setKeep] = useState<string | null>(null);
    const [fold, setFold] = useState<string[]>([]);
    const [filter, setFilter] = useState('');

    const byId = (id: string) => skills.filter((s) => s.id === id)[0];

    // Near-misses of whatever is selected, surfaced first — the useful merge is
    // almost always a busy tag and something a letter or two away from it.
    const near = (a: string, b: string) => {
        const x = skillCompact(a);
        const y = skillCompact(b);
        if (!x || !y) return false;
        return x.indexOf(y) !== -1 || y.indexOf(x) !== -1;
    };

    const keeper = keep ? byId(keep) : null;

    const shown = skills
        .filter((s) => s.id !== keep)
        .filter((s) => !filter.trim() || skillCompact(s.label).indexOf(skillCompact(filter)) !== -1)
        .sort((a, b) => {
            if (keeper) {
                const an = near(a.label, keeper.label) ? 0 : 1;
                const bn = near(b.label, keeper.label) ? 0 : 1;
                if (an !== bn) return an - bn;
            }
            return (b.uses || 0) - (a.uses || 0) || String(a.label).localeCompare(String(b.label));
        });

    const merge = async () => {
        if (!keep || fold.length === 0) return;

        setBusy(true);

        for (const fromId of fold) {
            const res = await fetch('/api/admin/skills', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'merge', fromId, toId: keep }),
            });

            const body = await res.json().catch(() => ({}));

            if (!res.ok) {
                setBusy(false);
                toast.error(body.error || 'That merge did not go through.', { theme: 'colored' });
                router.refresh();
                return;
            }
        }

        setBusy(false);
        toast.success('Merged.', { theme: 'colored' });
        setKeep(null);
        setFold([]);
        router.refresh();
    };

    const setConcept = async (id: string, concept: string) => {
        setBusy(true);

        const res = await fetch('/api/admin/skills', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set_concept', id, concept }),
        });

        setBusy(false);

        if (!res.ok) {
            toast.error('That did not save.', { theme: 'colored' });
            return;
        }

        toast.success('Saved.', { theme: 'colored' });
        router.refresh();
    };

    return (
        <div>
            <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Find a tag"
                className="w-full md:max-w-sm rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-emerald-700"
            />

            {keeper && (
                <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 mb-4">
                    <p className="text-sm text-emerald-900">
                        Keeping <strong>{keeper.label}</strong>
                        {fold.length > 0 && (
                            <>
                                {' '}and folding in{' '}
                                <strong>{fold.map((id) => byId(id)?.label).filter(Boolean).join(', ')}</strong>
                            </>
                        )}
                        .
                    </p>
                    <div className="flex flex-wrap gap-3 mt-3">
                        <button
                            type="button"
                            onClick={merge}
                            disabled={busy || fold.length === 0}
                            className="rounded-full bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2 text-sm font-semibold transition disabled:opacity-60"
                        >
                            {busy ? 'Merging…' : 'Merge'}
                        </button>
                        <button
                            type="button"
                            onClick={() => { setKeep(null); setFold([]); }}
                            className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className="space-y-2">
                {shown.map((s) => (
                    <div
                        key={s.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3"
                    >
                        <span className="font-medium text-slate-900">{s.label}</span>
                        <span className="text-xs text-slate-500">
                            {s.uses} {s.uses === 1 ? 'business' : 'businesses'}
                        </span>

                        <select
                            value={s.regulated_concept || ''}
                            onChange={(e) => setConcept(s.id, e.target.value)}
                            disabled={busy}
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                        >
                            {CONCEPTS.map((c) => (
                                <option key={c.key} value={c.key}>{c.label}</option>
                            ))}
                        </select>

                        <span className="ml-auto flex gap-2">
                            {!keep && (
                                <button
                                    type="button"
                                    onClick={() => setKeep(s.id)}
                                    className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-500"
                                >
                                    Keep this one
                                </button>
                            )}
                            {keep && (
                                <button
                                    type="button"
                                    onClick={() => setFold(
                                        fold.indexOf(s.id) === -1
                                            ? [...fold, s.id]
                                            : fold.filter((x) => x !== s.id)
                                    )}
                                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                                        fold.indexOf(s.id) !== -1
                                            ? 'bg-slate-900 text-white'
                                            : 'border border-slate-300 text-slate-700 hover:border-slate-500'
                                    }`}
                                >
                                    {fold.indexOf(s.id) !== -1 ? 'Folding in' : 'Fold into it'}
                                </button>
                            )}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
