'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Trash2, Plus } from 'lucide-react';
import { EditorCard, EditorPanel, PanelSave } from '@/components/listing-editor/EditorPanel';
import { bigFieldCls } from '@/components/services/wizardKit';
import {
    extraProblem, unitLabel, vatLabel,
    EXTRA_LABEL_MAX, EXTRA_DESCRIPTION_MAX,
    type ExtraUnit, type ExtraVat, type ListingExtra,
} from '@/lib/listingExtras';

// The host's optional paid extras for one listing — a sauna pack, a hamper, a
// log delivery. A raised summary card (Airbnb's editor shape) opens a panel
// where the host adds, prices and removes them. Writes straight to
// listing_extras under the host's own RLS policy; the DB CHECK constraints are
// the server-side half of the validation extraProblem does as the host types.
//
// Priced per stay or per night, with a VAT treatment per extra so a zero-rated
// hamper never prints a 20% line beside a standard-rated sauna. Extras ride the
// one stay charge and the one stay payout, with no commission.

interface DraftRow {
    key: string;        // local only, for React
    id?: string;        // present once saved
    label: string;
    description: string;
    price: string;
    unit: ExtraUnit;
    vat_treatment: ExtraVat;
    active: boolean;
}

let keySeq = 0;
function nextKey(): string { keySeq += 1; return 'row-' + keySeq; }

function toDraft(row: ListingExtra): DraftRow {
    return {
        key: nextKey(),
        id: row.id,
        label: row.label || '',
        description: row.description || '',
        price: row.price != null ? String(row.price) : '',
        unit: row.unit === 'night' ? 'night' : 'stay',
        vat_treatment: row.vat_treatment === 'zero' ? 'zero' : 'standard',
        active: row.active !== false,
    };
}

function blankDraft(): DraftRow {
    return { key: nextKey(), label: '', description: '', price: '', unit: 'stay', vat_treatment: 'standard', active: true };
}

export default function ExtrasEditor({ listingId }: { listingId: string }) {
    const supabase = createClientComponentClient();
    const [rows, setRows] = useState<ListingExtra[]>([]);
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<DraftRow[]>([]);
    const [error, setError] = useState('');

    const load = async () => {
        const { data } = await supabase
            .from('listing_extras')
            .select('id, label, description, price, unit, vat_treatment, active, sort_order')
            .eq('listing_id', listingId)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });
        setRows((data || []) as ListingExtra[]);
    };

    useEffect(() => {
        if (listingId) load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listingId]);

    const openPanel = () => {
        setDraft(rows.length ? rows.map(toDraft) : [blankDraft()]);
        setError('');
        setOpen(true);
    };

    const setRow = (key: string, patch: Partial<DraftRow>) =>
        setDraft((d) => d.map((r) => (r.key === key ? { ...r, ...patch } : r)));

    const removeRow = (key: string) => setDraft((d) => d.filter((r) => r.key !== key));

    const save = async () => {
        setError('');
        // A row the host left completely blank is simply dropped, so an empty
        // "add another" row never blocks the save.
        const filled = draft.filter((r) => r.label.trim() || r.description.trim() || r.price.trim());

        for (const r of filled) {
            const problem = extraProblem(r);
            if (problem) { setError(problem + (r.label.trim() ? ' (' + r.label.trim() + ')' : '')); return false; }
        }

        const keptIds = new Set(filled.filter((r) => r.id).map((r) => r.id as string));
        const toDelete = rows.filter((r) => !keptIds.has(r.id)).map((r) => r.id);

        try {
            if (toDelete.length) {
                const { error: delErr } = await supabase.from('listing_extras').delete().in('id', toDelete);
                if (delErr) throw delErr;
            }
            for (let i = 0; i < filled.length; i++) {
                const r = filled[i];
                const record = {
                    listing_id: listingId,
                    label: r.label.trim(),
                    description: r.description.trim() || null,
                    price: Number(r.price),
                    unit: r.unit,
                    vat_treatment: r.vat_treatment,
                    active: r.active,
                    sort_order: i,
                };
                if (r.id) {
                    const { error: upErr } = await supabase.from('listing_extras').update(record).eq('id', r.id);
                    if (upErr) throw upErr;
                } else {
                    const { error: insErr } = await supabase.from('listing_extras').insert(record);
                    if (insErr) throw insErr;
                }
            }
            await load();
            setOpen(false);
            return true;
        } catch (e: any) {
            setError(e?.message || 'Could not save your extras. Please try again.');
            return false;
        }
    };

    const liveCount = rows.filter((r) => r.active !== false).length;
    const summary = rows.length
        ? rows.slice(0, 3).map((r) => r.label).join(', ') + (rows.length > 3 ? ` +${rows.length - 3} more` : '')
        : 'None yet — add a sauna pack, a hamper, late checkout…';

    return (
        <>
            <EditorCard
                title={liveCount ? `Extras · ${liveCount} offered` : 'Extras'}
                summary={summary}
                onClick={openPanel}
            />
            {open && (
                <EditorPanel
                    title="Extras"
                    onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={save} />}
                >
                    <p className="mb-4 text-sm text-slate-500">
                        Optional paid extras a guest can add when they book — a sauna pack, a
                        hamper, late checkout. They&rsquo;re added to the stay and paid out with
                        it, and we take no commission on them.
                    </p>

                    <div className="space-y-4">
                        {draft.map((r) => (
                            <div key={r.key} className="rounded-2xl border border-slate-200 p-4">
                                <div className="flex items-start gap-2">
                                    <input
                                        className={bigFieldCls + ' flex-1'}
                                        placeholder="Name, e.g. Sauna pack"
                                        maxLength={EXTRA_LABEL_MAX}
                                        value={r.label}
                                        onChange={(e) => setRow(r.key, { label: e.target.value })}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => removeRow(r.key)}
                                        aria-label="Remove this extra"
                                        className="mt-2 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>

                                <textarea
                                    className={bigFieldCls + ' mt-2 w-full'}
                                    rows={2}
                                    placeholder="A short description (optional)"
                                    maxLength={EXTRA_DESCRIPTION_MAX}
                                    value={r.description}
                                    onChange={(e) => setRow(r.key, { description: e.target.value })}
                                />

                                <div className="mt-2 flex items-center gap-2">
                                    <span className="text-slate-500">£</span>
                                    <input
                                        className={bigFieldCls + ' w-28'}
                                        inputMode="decimal"
                                        placeholder="0.00"
                                        value={r.price}
                                        onChange={(e) => setRow(r.key, { price: e.target.value })}
                                    />
                                    <div className="flex rounded-lg border border-slate-200 p-0.5 text-sm">
                                        {(['stay', 'night'] as ExtraUnit[]).map((u) => (
                                            <button
                                                key={u}
                                                type="button"
                                                onClick={() => setRow(r.key, { unit: u })}
                                                className={`rounded-md px-3 py-1.5 ${r.unit === u ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                                            >
                                                {unitLabel(u)}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="mt-3">
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">VAT</div>
                                    <div className="mt-1 flex flex-col gap-1.5 sm:flex-row sm:gap-2">
                                        {(['standard', 'zero'] as ExtraVat[]).map((v) => (
                                            <button
                                                key={v}
                                                type="button"
                                                onClick={() => setRow(r.key, { vat_treatment: v })}
                                                className={`rounded-lg border px-3 py-1.5 text-left text-sm ${r.vat_treatment === v ? 'border-slate-900 bg-slate-50' : 'border-slate-200 text-slate-600'}`}
                                            >
                                                {vatLabel(v)}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="mt-1 text-xs text-slate-400">
                                        Set this to how the extra is rated. Standard puts a 20% line on
                                        the guest&rsquo;s receipt; zero-rated (a hamper, say) shows no VAT.
                                    </p>
                                </div>

                                <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={r.active}
                                        onChange={(e) => setRow(r.key, { active: e.target.checked })}
                                    />
                                    Offered to guests
                                </label>
                            </div>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={() => setDraft((d) => [...d, blankDraft()])}
                        className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:underline"
                    >
                        <Plus className="h-4 w-4" /> Add an extra
                    </button>

                    <p className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
                        If a guest cancels, an extra is refunded on the same terms as the stay —
                        it follows your cancellation policy, just like the nights.
                    </p>

                    {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                </EditorPanel>
            )}
        </>
    );
}
