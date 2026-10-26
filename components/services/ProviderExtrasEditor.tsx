'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { Trash2, Plus, Image as ImageIcon, X, ArrowLeft } from 'lucide-react';
import { EditorCard, EditorPanel } from '@/components/listing-editor/EditorPanel';
import { QuestionSheetContext } from '@/components/listing-editor/questionSheets';
import { useCardSheet, SheetFooter } from '@/components/services/editorSheet';
import { BigTextInput, BigAmountInput, ChoiceTiles, wizardAreaCls, wizardPrimaryCls } from '@/components/services/wizardKit';
import { compressImage, readImageDimensions } from '@/lib/compressImage';
import { photoDimensionProblem, EXTRA_CROP_ASPECT } from '@/lib/photoRules';
import { generateRandomNumber, getImageUrl } from '@/lib/utils';
import { formatGBP } from '@/lib/formatMoney';
import Env from '@/config/Env';
import {
    providerExtraProblem, providerUnitLabel, providerVatLabel,
    EXTRA_LABEL_MAX, EXTRA_DESCRIPTION_MAX,
    type ProviderExtraUnit, type ExtraVat, type ProviderExtra,
} from '@/lib/providerExtras';

// A provider's optional paid extras, built on the SAME editor mechanisms as the
// stays extras editor (a one-question-at-a-time add wizard, raised cards to
// edit), but for an EXPERIENCE: units are per booking / per person (never per
// night), and the write goes through the guest-listing save route (service
// role, section 'extras') rather than a direct browser write — the same route
// every other provider section uses. The whole set is sent on each change and
// the route reconciles insert/update/delete.

const UNIT_OPTIONS = [
    { value: 'booking', label: 'Per booking', hint: 'Charged once' },
    { value: 'person', label: 'Per person', hint: 'Once a guest' },
];

const PRICE_NOTE = 'We take our usual commission on this, the same as the experience price. Refunded on the same terms as the booking if the guest cancels.';

const QUESTIONS = {
    name: 'What’s the extra called?',
    price: 'What does it cost?',
    describe: 'Describe it',
    photo: 'Add a photo',
};

async function uploadExtraPhoto(supabase: any, file: File): Promise<string | null> {
    const size = await readImageDimensions(file);
    if (size.width && size.height) {
        const problem = photoDimensionProblem(size.width, size.height);
        if (problem) { toast.error(problem, { theme: 'colored' }); return null; }
    }
    try {
        const small = await compressImage(file);
        const path = `${Date.now()}_${generateRandomNumber()}`;
        const { data, error } = await supabase.storage
            .from(Env.S3_BUCKET)
            .upload(path, small, { contentType: small.type || 'image/jpeg', cacheControl: '3600', upsert: false });
        if (error) throw error;
        return data?.path || path;
    } catch (e: any) {
        toast.error('That photo didn’t upload: ' + (e?.message || 'try again'), { theme: 'colored' });
        return null;
    }
}

function PhotoField({ photo, uploading, onPick, onRemove }: {
    photo: string | null; uploading: boolean; onPick: (file: File) => void; onRemove: () => void;
}) {
    return (
        <div>
            {photo ? (
                <div>
                    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100" style={{ aspectRatio: EXTRA_CROP_ASPECT }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={getImageUrl(photo)} alt="" className="absolute inset-0 h-full w-full object-cover" />
                        <button type="button" onClick={onRemove} aria-label="Remove photo"
                            className="absolute right-2 top-2 rounded-full bg-black/55 p-1.5 text-white hover:bg-black/70">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <label className="mt-2 inline-block cursor-pointer text-sm font-medium text-slate-600 hover:underline">
                        {uploading ? 'Uploading…' : 'Replace photo'}
                        <input type="file" accept="image/png, image/jpeg" className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }} />
                    </label>
                </div>
            ) : (
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-sm text-slate-600 hover:border-slate-400">
                    <ImageIcon className="h-4 w-4 flex-none" />
                    {uploading ? 'Uploading…' : 'Add a photo'}
                    <input type="file" accept="image/png, image/jpeg" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }} />
                </label>
            )}
            <p className="mt-2 text-sm text-slate-400">
                Shown cropped to a wide 3:2. At least 1024 &times; 683 px; straight from your phone is fine &mdash; we&rsquo;ll shrink it. Optional.
            </p>
        </div>
    );
}

function MaxQtyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div className="mx-auto mt-8 w-full max-w-xs">
            <label className="block text-sm font-medium text-slate-700">Most a guest can add (optional)</label>
            <input type="text" inputMode="numeric" aria-label="Maximum quantity" placeholder="No limit"
                value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200" />
            <p className="mt-1.5 text-xs text-slate-400">Leave blank for no limit.</p>
        </div>
    );
}

// ---------------------------------------------------------------- edit cards

function NameCard({ extra, save }: { extra: ProviderExtra; save: (patch: Partial<ProviderExtra>) => Promise<boolean> }) {
    const c = useCardSheet(extra.label || '', (v: string) => {
        const problem = providerExtraProblem({ ...extra, label: v });
        if (problem) { toast.error(problem, { theme: 'colored' }); return false; }
        return save({ label: v.trim() });
    });
    return (
        <>
            <EditorCard title="Name" summary={extra.label || 'Add a name'} onClick={c.start} />
            {c.open && (
                <EditorPanel title={QUESTIONS.name} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <BigTextInput autoFocus ariaLabel={QUESTIONS.name} placeholder="e.g. Sauna pack" maxLength={EXTRA_LABEL_MAX} value={c.draft} onChange={c.setDraft} />
                </EditorPanel>
            )}
        </>
    );
}

function PriceCard({ extra, save }: { extra: ProviderExtra; save: (patch: Partial<ProviderExtra>) => Promise<boolean> }) {
    const c = useCardSheet<{ price: string; unit: ProviderExtraUnit; maxQty: string }>(
        {
            price: extra.price != null ? String(extra.price) : '',
            unit: extra.unit === 'person' ? 'person' : 'booking',
            maxQty: extra.max_qty != null ? String(extra.max_qty) : '',
        },
        (d) => {
            const problem = providerExtraProblem({ ...extra, price: d.price, unit: d.unit, max_qty: d.maxQty });
            if (problem) { toast.error(problem, { theme: 'colored' }); return false; }
            return save({ price: Number(d.price), unit: d.unit, max_qty: d.maxQty.trim() ? Number(d.maxQty) : null });
        },
    );
    const capNote = extra.max_qty ? ` · up to ${extra.max_qty}` : '';
    return (
        <>
            <EditorCard title="Price" summary={`${formatGBP(Number(extra.price))} ${providerUnitLabel(extra.unit)}${capNote}`} onClick={c.start} />
            {c.open && (
                <EditorPanel title={QUESTIONS.price} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <BigAmountInput autoFocus numeric={false} ariaLabel="Price" value={c.draft.price}
                        onChange={(raw) => c.setDraft({ ...c.draft, price: raw.replace(/[^0-9.]/g, '') })} />
                    <div className="mx-auto mt-8 w-full max-w-xs">
                        <ChoiceTiles options={UNIT_OPTIONS} value={c.draft.unit} onChange={(v) => c.setDraft({ ...c.draft, unit: v as ProviderExtraUnit })} />
                    </div>
                    <MaxQtyField value={c.draft.maxQty} onChange={(v) => c.setDraft({ ...c.draft, maxQty: v })} />
                    <p className="mx-auto mt-6 max-w-xs text-center text-xs text-slate-500">{PRICE_NOTE}</p>
                </EditorPanel>
            )}
        </>
    );
}

function DescriptionCard({ extra, save }: { extra: ProviderExtra; save: (patch: Partial<ProviderExtra>) => Promise<boolean> }) {
    const c = useCardSheet(extra.description || '', (v: string) => save({ description: v.trim() || null }));
    return (
        <>
            <EditorCard title="Description" summary={extra.description || 'Add a description'} onClick={c.start} />
            {c.open && (
                <EditorPanel title={QUESTIONS.describe} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <textarea autoFocus rows={4} className={wizardAreaCls} maxLength={EXTRA_DESCRIPTION_MAX}
                        placeholder="What the guest gets." value={c.draft} onChange={(e) => c.setDraft(e.target.value)} />
                </EditorPanel>
            )}
        </>
    );
}

function PhotoCard({ extra, supabase, save }: { extra: ProviderExtra; supabase: any; save: (patch: Partial<ProviderExtra>) => Promise<boolean> }) {
    const c = useCardSheet<string | null>(extra.photo || null, (pth) => save({ photo: pth }));
    const [uploading, setUploading] = useState(false);
    const pick = async (file: File) => {
        setUploading(true);
        const path = await uploadExtraPhoto(supabase, file);
        setUploading(false);
        if (path) c.setDraft(path);
    };
    return (
        <>
            <EditorCard title="Photo" summary={extra.photo ? 'Added' : 'Add a photo'} onClick={c.start}>
                {extra.photo && (
                    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200" style={{ aspectRatio: EXTRA_CROP_ASPECT, maxWidth: '12rem' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={getImageUrl(extra.photo)} alt="" className="h-full w-full object-cover" />
                    </div>
                )}
            </EditorCard>
            {c.open && (
                <EditorPanel title={QUESTIONS.photo} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <PhotoField photo={c.draft} uploading={uploading} onPick={pick} onRemove={() => c.setDraft(null)} />
                </EditorPanel>
            )}
        </>
    );
}

function OfferedCard({ extra, save }: { extra: ProviderExtra; save: (patch: Partial<ProviderExtra>) => Promise<boolean> }) {
    const c = useCardSheet<string>(extra.active === false ? 'no' : 'yes', (v) => save({ active: v === 'yes' }));
    return (
        <>
            <EditorCard title="Offered to guests" summary={extra.active === false ? 'Hidden' : 'Shown to guests'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Offer this to guests?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="mx-auto w-full max-w-xs">
                        <ChoiceTiles value={c.draft} onChange={c.setDraft}
                            options={[{ value: 'yes', label: 'Offered', hint: 'Guests can add it' }, { value: 'no', label: 'Hidden', hint: 'Not shown' }]} />
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

function VatCard({ extra, save }: { extra: ProviderExtra; save: (patch: Partial<ProviderExtra>) => Promise<boolean> }) {
    const c = useCardSheet<string>(extra.vat_treatment === 'zero' ? 'zero' : 'standard', (v) => save({ vat_treatment: v as ExtraVat }));
    return (
        <>
            <EditorCard title="VAT" summary={providerVatLabel(extra.vat_treatment)} onClick={c.start} />
            {c.open && (
                <EditorPanel title="How is this extra rated for VAT?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="mx-auto w-full max-w-sm">
                        <ChoiceTiles cols={1} value={c.draft} onChange={c.setDraft}
                            options={[
                                { value: 'standard', label: providerVatLabel('standard'), hint: 'Puts a 20% line on the receipt' },
                                { value: 'zero', label: providerVatLabel('zero'), hint: 'A hamper, say — no VAT line' },
                            ]} />
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

function ExtraEditPanel({ extra, supabase, vatRegistered, onBack, save, onDelete }: {
    extra: ProviderExtra; supabase: any; vatRegistered: boolean;
    onBack: () => void; save: (patch: Partial<ProviderExtra>) => Promise<boolean>; onDelete: () => void;
}) {
    const back = (
        <button type="button" onClick={onBack} aria-label="Back" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100">
            <ArrowLeft className="h-5 w-5" />
        </button>
    );
    return (
        <EditorPanel title={extra.label || 'Extra'} onClose={onBack} leading={back}>
            <div className="space-y-4">
                <NameCard extra={extra} save={save} />
                <PriceCard extra={extra} save={save} />
                <DescriptionCard extra={extra} save={save} />
                <PhotoCard extra={extra} supabase={supabase} save={save} />
                <OfferedCard extra={extra} save={save} />
                {vatRegistered && <VatCard extra={extra} save={save} />}
                <button type="button" onClick={onDelete}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-200 py-3 text-sm font-semibold text-red-600 hover:bg-red-50">
                    <Trash2 className="h-4 w-4" /> Remove this extra
                </button>
            </div>
        </EditorPanel>
    );
}

// ---------------------------------------------------------------- add wizard

interface WizardDraft { label: string; description: string; price: string; unit: ProviderExtraUnit; photo: string | null; maxQty: string }

function AddExtraWizard({ supabase, onClose, onAdd }: {
    supabase: any; onClose: () => void; onAdd: (draft: WizardDraft) => Promise<boolean>;
}) {
    const STEPS = ['name', 'price', 'describe', 'photo', 'review'] as const;
    const [idx, setIdx] = useState(0);
    const [busy, setBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [d, setD] = useState<WizardDraft>({ label: '', description: '', price: '', unit: 'booking', photo: null, maxQty: '' });
    const set = (patch: Partial<WizardDraft>) => setD((cur) => ({ ...cur, ...patch }));

    const key = STEPS[idx];
    const isReview = key === 'review';

    const valid = (): boolean => {
        if (key === 'name') return !providerExtraProblem({ label: d.label, price: '1', unit: d.unit, vat_treatment: 'standard' });
        if (key === 'price') return !providerExtraProblem({ label: d.label || 'x', price: d.price, unit: d.unit, vat_treatment: 'standard', max_qty: d.maxQty });
        return true;
    };

    const title = isReview ? 'Ready to add?'
        : key === 'name' ? QUESTIONS.name
        : key === 'price' ? QUESTIONS.price
        : key === 'describe' ? QUESTIONS.describe
        : QUESTIONS.photo;

    const next = async () => {
        if (!isReview) { setIdx(idx + 1); return; }
        if (busy) return;
        setBusy(true);
        try { if (await onAdd(d)) onClose(); } finally { setBusy(false); }
    };

    const back = (
        <button type="button" onClick={() => (idx === 0 ? onClose() : setIdx(idx - 1))} aria-label="Back"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100">
            <ArrowLeft className="h-5 w-5" />
        </button>
    );

    const nextBtn = (
        <button type="button" onClick={next} disabled={busy || !valid()} className={wizardPrimaryCls(busy || !valid())}>
            {busy ? 'Adding…' : isReview ? 'Add extra' : 'Next'}
        </button>
    );

    const pickPhoto = async (file: File) => {
        setUploading(true);
        const path = await uploadExtraPhoto(supabase, file);
        setUploading(false);
        if (path) set({ photo: path });
    };

    return (
        <EditorPanel title={title} onClose={onClose} leading={back} footer={nextBtn} alignTop={key === 'photo' || isReview}>
            {(key === 'describe' || key === 'photo') && (
                <p className="mb-4 text-center text-sm text-slate-500">Optional — you can skip this.</p>
            )}
            {key === 'name' && (
                <BigTextInput autoFocus ariaLabel={QUESTIONS.name} placeholder="e.g. Sauna pack" maxLength={EXTRA_LABEL_MAX}
                    value={d.label} onChange={(v) => set({ label: v })} />
            )}
            {key === 'price' && (
                <div>
                    <BigAmountInput autoFocus numeric={false} ariaLabel="Price" value={d.price}
                        onChange={(raw) => set({ price: raw.replace(/[^0-9.]/g, '') })} />
                    <div className="mx-auto mt-8 w-full max-w-xs">
                        <ChoiceTiles options={UNIT_OPTIONS} value={d.unit} onChange={(v) => set({ unit: v as ProviderExtraUnit })} />
                    </div>
                    <MaxQtyField value={d.maxQty} onChange={(v) => set({ maxQty: v })} />
                    <p className="mx-auto mt-6 max-w-xs text-center text-xs text-slate-500">{PRICE_NOTE}</p>
                </div>
            )}
            {key === 'describe' && (
                <textarea autoFocus rows={4} className={wizardAreaCls} maxLength={EXTRA_DESCRIPTION_MAX}
                    placeholder="What the guest gets." value={d.description} onChange={(e) => set({ description: e.target.value })} />
            )}
            {key === 'photo' && (
                <PhotoField photo={d.photo} uploading={uploading} onPick={pickPhoto} onRemove={() => set({ photo: null })} />
            )}
            {isReview && (
                <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4">
                    {d.photo && (
                        <div className="mb-3 overflow-hidden rounded-xl border border-slate-200" style={{ aspectRatio: EXTRA_CROP_ASPECT }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={getImageUrl(d.photo)} alt="" className="h-full w-full object-cover" />
                        </div>
                    )}
                    <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-slate-900">{d.label.trim() || 'Your extra'}</span>
                        <span className="text-sm text-slate-600">{formatGBP(Number(d.price))} {providerUnitLabel(d.unit)}</span>
                    </div>
                    {d.description.trim() && <p className="mt-1 text-sm text-slate-500">{d.description.trim()}</p>}
                </div>
            )}
        </EditorPanel>
    );
}

// ---------------------------------------------------------------- the editor

export default function ProviderExtrasEditor({ providerId, vatRegistered = false }: { providerId: string; vatRegistered?: boolean }) {
    const supabase = createClientComponentClient();
    const [rows, setRows] = useState<ProviderExtra[]>([]);
    const [open, setOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);

    const load = async () => {
        const { data } = await supabase
            .from('provider_extras')
            .select('id, label, description, price, unit, vat_treatment, active, sort_order, photo, max_qty')
            .eq('provider_id', providerId)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });
        setRows((data || []) as ProviderExtra[]);
    };

    useEffect(() => {
        if (providerId) load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [providerId]);

    // Every change sends the WHOLE set to the guest-listing save route, which
    // reconciles insert/update/delete — the same contract the items section
    // uses. The local state is replaced with what we sent so the cards and the
    // guest page agree, and a save that fails leaves the stored set untouched.
    const persist = async (next: ProviderExtra[]): Promise<boolean> => {
        try {
            const res = await fetch('/api/services/listing/save', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    providerId, section: 'extras',
                    data: { extras: next.map((r, i) => ({ ...r, sort_order: i })) },
                }),
            });
            const json = await res.json().catch(() => null);
            if (!json || !json.ok) { toast.error((json && json.error) || 'Could not save', { theme: 'colored' }); return false; }
            await load();
            return true;
        } catch (e: any) {
            toast.error(e?.message || 'Could not save', { theme: 'colored' });
            return false;
        }
    };

    const addExtra = async (d: WizardDraft): Promise<boolean> => {
        const problem = providerExtraProblem({ label: d.label, description: d.description, price: d.price, unit: d.unit, vat_treatment: 'standard', max_qty: d.maxQty });
        if (problem) { toast.error(problem, { theme: 'colored' }); return false; }
        const row: ProviderExtra = {
            id: '', label: d.label.trim(), description: d.description.trim() || null,
            price: Number(d.price), unit: d.unit, vat_treatment: 'standard', active: true,
            max_qty: d.maxQty.trim() ? Number(d.maxQty) : null, photo: d.photo,
        };
        // A blank id means "insert" to the route; strip it so it is not sent.
        const { id: _drop, ...clean } = row as any;
        return persist([...rows, clean]);
    };

    const saveExtra = (extra: ProviderExtra) => async (patch: Partial<ProviderExtra>): Promise<boolean> =>
        persist(rows.map((r) => (r.id === extra.id ? { ...r, ...patch } : r)));

    const removeExtra = async (id: string) => {
        const ok = await persist(rows.filter((r) => r.id !== id));
        if (ok) setEditingId(null);
    };

    const liveCount = rows.filter((r) => r.active !== false).length;
    const summary = rows.length
        ? rows.slice(0, 3).map((r) => r.label).join(', ') + (rows.length > 3 ? ` +${rows.length - 3} more` : '')
        : 'None yet — add a sauna pack, a hamper, club hire…';

    const editing = rows.find((r) => r.id === editingId) || null;

    return (
        <QuestionSheetContext.Provider value={true}>
            <EditorCard
                title={liveCount ? `Extras · ${liveCount} offered` : 'Extras'}
                summary={summary}
                onClick={() => setOpen(true)}
            />

            {open && (
                <EditorPanel title="Extras" onClose={() => setOpen(false)}>
                    <p className="mb-4 text-sm text-slate-500">
                        Optional paid extras a guest adds when they book — a sauna pack, a
                        hamper, club hire.
                    </p>
                    <div className="space-y-3">
                        {rows.map((e) => (
                            <EditorCard
                                key={e.id}
                                title={e.label + (e.active === false ? '  ·  Hidden' : '')}
                                summary={`${formatGBP(Number(e.price))} ${providerUnitLabel(e.unit)}`}
                                onClick={() => setEditingId(e.id)}
                            >
                                {e.photo && (
                                    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200" style={{ aspectRatio: EXTRA_CROP_ASPECT, maxWidth: '12rem' }}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={getImageUrl(e.photo)} alt="" className="h-full w-full object-cover" />
                                    </div>
                                )}
                            </EditorCard>
                        ))}
                    </div>
                    <button type="button" onClick={() => setAdding(true)}
                        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-3 text-sm font-semibold text-slate-900 hover:border-slate-400">
                        <Plus className="h-4 w-4" /> Add an extra
                    </button>
                </EditorPanel>
            )}

            {editing && (
                <ExtraEditPanel
                    extra={editing}
                    supabase={supabase}
                    vatRegistered={vatRegistered}
                    onBack={() => setEditingId(null)}
                    save={saveExtra(editing)}
                    onDelete={() => removeExtra(editing.id)}
                />
            )}

            {adding && (
                <AddExtraWizard supabase={supabase} onClose={() => setAdding(false)} onAdd={addExtra} />
            )}
        </QuestionSheetContext.Provider>
    );
}
