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
    extraProblem, unitLabel, vatLabel,
    EXTRA_LABEL_MAX, EXTRA_DESCRIPTION_MAX,
    type ExtraUnit, type ExtraVat, type ListingExtra,
} from '@/lib/listingExtras';

// The host's optional paid extras for one listing, built on the SAME mechanisms
// as the rest of the editor rather than one long form:
//   * a new extra is added through a one-question-at-a-time wizard, with a back
//     arrow top-left that steps back through the questions (the experience
//     offering add flow's register);
//   * an existing extra opens as its own set of raised cards — name, price,
//     description, photo, offered, and (only for a VAT-registered host) VAT —
//     each opening its own sheet and saving itself, like the main editor's cards.
//
// VAT is shown only to a VAT-registered host, exactly as the experiences
// offering editor gates it; an unregistered host sees nothing about it and their
// extras stay 'standard', which is moot for them.

// ---------------------------------------------------------------- shared bits

const UNIT_OPTIONS = [
    { value: 'stay', label: 'Per stay', hint: 'Charged once' },
    { value: 'night', label: 'Per night', hint: 'Once a night' },
];

const QUESTIONS = {
    name: 'What’s the extra called?',
    price: 'What does it cost?',
    describe: 'Describe it',
    photo: 'Add a photo',
};

// Upload one photo exactly as a listing photo: refuse one too small (the same
// message), shrink it, store it in the same bucket. Returns the path or null.
async function uploadExtraPhoto(
    supabase: any,
    file: File,
): Promise<string | null> {
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

// The photo block shared by the edit card and the wizard: a 3:2 crop preview
// (the same the guest sees) with Add / Replace / Remove, and the size note.
function PhotoField({ photo, uploading, onPick, onRemove }: {
    photo: string | null;
    uploading: boolean;
    onPick: (file: File) => void;
    onRemove: () => void;
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

// ---------------------------------------------------------------- edit cards
// Each card: a raised EditorCard summary + its own sheet that saves itself
// through `save` (an update on this extra's row that returns ok).

function NameCard({ extra, save }: { extra: ListingExtra; save: (patch: Partial<ListingExtra>) => Promise<boolean> }) {
    const c = useCardSheet(extra.label || '', (v: string) => {
        const problem = extraProblem({ ...extra, label: v });
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

function PriceCard({ extra, save }: { extra: ListingExtra; save: (patch: Partial<ListingExtra>) => Promise<boolean> }) {
    const c = useCardSheet<{ price: string; unit: ExtraUnit }>(
        { price: extra.price != null ? String(extra.price) : '', unit: extra.unit === 'night' ? 'night' : 'stay' },
        (d) => {
            const problem = extraProblem({ ...extra, price: d.price, unit: d.unit });
            if (problem) { toast.error(problem, { theme: 'colored' }); return false; }
            return save({ price: Number(d.price), unit: d.unit });
        },
    );
    return (
        <>
            <EditorCard title="Price" summary={`${formatGBP(Number(extra.price))} ${unitLabel(extra.unit)}`} onClick={c.start} />
            {c.open && (
                <EditorPanel title={QUESTIONS.price} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <BigAmountInput autoFocus numeric={false} ariaLabel="Price" value={c.draft.price}
                        onChange={(raw) => c.setDraft({ ...c.draft, price: raw.replace(/[^0-9.]/g, '') })} />
                    <div className="mx-auto mt-8 w-full max-w-xs">
                        <ChoiceTiles options={UNIT_OPTIONS} value={c.draft.unit} onChange={(v) => c.setDraft({ ...c.draft, unit: v as ExtraUnit })} />
                    </div>
                    <p className="mx-auto mt-6 max-w-xs text-center text-xs text-slate-500">
                        You keep the full price — we take no commission. Refunded on the same terms as the stay if the guest cancels.
                    </p>
                </EditorPanel>
            )}
        </>
    );
}

function DescriptionCard({ extra, save }: { extra: ListingExtra; save: (patch: Partial<ListingExtra>) => Promise<boolean> }) {
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

function PhotoCard({ extra, supabase, save }: { extra: ListingExtra; supabase: any; save: (patch: Partial<ListingExtra>) => Promise<boolean> }) {
    const c = useCardSheet<string | null>(extra.photo || null, (p) => save({ photo: p }));
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

function OfferedCard({ extra, save }: { extra: ListingExtra; save: (patch: Partial<ListingExtra>) => Promise<boolean> }) {
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

function VatCard({ extra, save }: { extra: ListingExtra; save: (patch: Partial<ListingExtra>) => Promise<boolean> }) {
    const c = useCardSheet<string>(extra.vat_treatment === 'zero' ? 'zero' : 'standard', (v) => save({ vat_treatment: v as ExtraVat }));
    return (
        <>
            <EditorCard title="VAT" summary={vatLabel(extra.vat_treatment)} onClick={c.start} />
            {c.open && (
                <EditorPanel title="How is this extra rated for VAT?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="mx-auto w-full max-w-sm">
                        <ChoiceTiles cols={1} value={c.draft} onChange={c.setDraft}
                            options={[
                                { value: 'standard', label: vatLabel('standard'), hint: 'Puts a 20% line on the receipt' },
                                { value: 'zero', label: vatLabel('zero'), hint: 'A hamper, say — no VAT line' },
                            ]} />
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

// One extra, opened from the list: its raised cards, each saving itself.
function ExtraEditPanel({ extra, supabase, vatRegistered, onBack, onChanged, onDelete }: {
    extra: ListingExtra;
    supabase: any;
    vatRegistered: boolean;
    onBack: () => void;
    onChanged: () => Promise<void> | void;
    onDelete: () => Promise<void> | void;
}) {
    const save = async (patch: Partial<ListingExtra>): Promise<boolean> => {
        const { error } = await supabase.from('listing_extras').update(patch).eq('id', extra.id);
        if (error) { toast.error(error.message, { theme: 'colored' }); return false; }
        await onChanged();
        return true;
    };
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

interface WizardDraft { label: string; description: string; price: string; unit: ExtraUnit; photo: string | null }

function AddExtraWizard({ supabase, onClose, onAdd }: {
    supabase: any;
    onClose: () => void;
    onAdd: (draft: WizardDraft) => Promise<boolean>;
}) {
    const STEPS = ['name', 'price', 'describe', 'photo', 'review'] as const;
    const [idx, setIdx] = useState(0);
    const [busy, setBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [d, setD] = useState<WizardDraft>({ label: '', description: '', price: '', unit: 'stay', photo: null });
    const set = (patch: Partial<WizardDraft>) => setD((cur) => ({ ...cur, ...patch }));

    const key = STEPS[idx];
    const isReview = key === 'review';

    const valid = (): boolean => {
        if (key === 'name') return !extraProblem({ label: d.label, price: '1', unit: d.unit, vat_treatment: 'standard' });
        if (key === 'price') return !extraProblem({ label: d.label || 'x', price: d.price, unit: d.unit, vat_treatment: 'standard' });
        return true; // describe, photo, review
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

    // The back arrow steps back through the questions, and closes the wizard on
    // the first one.
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
        <EditorPanel title={title}
            onClose={onClose} leading={back} footer={nextBtn} alignTop={key === 'photo' || isReview}>
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
                        <ChoiceTiles options={UNIT_OPTIONS} value={d.unit} onChange={(v) => set({ unit: v as ExtraUnit })} />
                    </div>
                    <p className="mx-auto mt-6 max-w-xs text-center text-xs text-slate-500">
                        You keep the full price — we take no commission. Refunded on the same terms as the stay if the guest cancels.
                    </p>
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
                        <span className="text-sm text-slate-600">{formatGBP(Number(d.price))} {unitLabel(d.unit)}</span>
                    </div>
                    {d.description.trim() && <p className="mt-1 text-sm text-slate-500">{d.description.trim()}</p>}
                </div>
            )}
        </EditorPanel>
    );
}

// ---------------------------------------------------------------- the editor

export default function ExtrasEditor({ listingId }: { listingId: string }) {
    const supabase = createClientComponentClient();
    const [rows, setRows] = useState<ListingExtra[]>([]);
    const [open, setOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    // VAT is shown only to a VAT-registered host — read the same way the account
    // VAT card does (GET /api/account/vat; the column is private), exactly as the
    // experiences offering editor gates its VAT card.
    const [vatRegistered, setVatRegistered] = useState(false);

    const load = async () => {
        const { data } = await supabase
            .from('listing_extras')
            .select('id, label, description, price, unit, vat_treatment, active, sort_order, photo')
            .eq('listing_id', listingId)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });
        setRows((data || []) as ListingExtra[]);
    };

    useEffect(() => {
        if (listingId) load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listingId]);

    useEffect(() => {
        let live = true;
        fetch('/api/account/vat')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => { if (live && data) setVatRegistered(data.registered === true); })
            .catch(() => { /* leave VAT hidden */ });
        return () => { live = false; };
    }, []);

    const addExtra = async (d: WizardDraft): Promise<boolean> => {
        const problem = extraProblem({ label: d.label, description: d.description, price: d.price, unit: d.unit, vat_treatment: 'standard' });
        if (problem) { toast.error(problem, { theme: 'colored' }); return false; }
        const { error } = await supabase.from('listing_extras').insert({
            listing_id: listingId,
            label: d.label.trim(),
            description: d.description.trim() || null,
            price: Number(d.price),
            unit: d.unit,
            vat_treatment: 'standard',
            active: true,
            sort_order: rows.length,
            photo: d.photo,
        });
        if (error) { toast.error(error.message, { theme: 'colored' }); return false; }
        await load();
        return true;
    };

    const removeExtra = async (id: string) => {
        const { error } = await supabase.from('listing_extras').delete().eq('id', id);
        if (error) { toast.error(error.message, { theme: 'colored' }); return; }
        await load();
        setEditingId(null);
    };

    const liveCount = rows.filter((r) => r.active !== false).length;
    const summary = rows.length
        ? rows.slice(0, 3).map((r) => r.label).join(', ') + (rows.length > 3 ? ` +${rows.length - 3} more` : '')
        : 'None yet — add a sauna pack, a hamper, late checkout…';

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
                        Optional paid extras a guest adds to their booking — a sauna pack, a
                        hamper, late checkout.
                    </p>

                    <div className="space-y-3">
                        {rows.map((e) => (
                            <EditorCard
                                key={e.id}
                                title={e.label + (e.active === false ? '  ·  Hidden' : '')}
                                summary={`${formatGBP(Number(e.price))} ${unitLabel(e.unit)}`}
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

                    <button
                        type="button"
                        onClick={() => setAdding(true)}
                        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-3 text-sm font-semibold text-slate-900 hover:border-slate-400"
                    >
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
                    onChanged={load}
                    onDelete={() => removeExtra(editing.id)}
                />
            )}

            {adding && (
                <AddExtraWizard supabase={supabase} onClose={() => setAdding(false)} onAdd={addExtra} />
            )}
        </QuestionSheetContext.Provider>
    );
}
