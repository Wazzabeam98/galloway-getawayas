'use client';

import { useState } from 'react';
import { toast } from 'react-toastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import Env from '@/config/Env';
import { getImageUrl, generateRandomNumber } from '@/lib/utils';
import { compressImage } from '@/lib/compressImage';
import { childrenAllowed } from '@/lib/guestAges';
import { cleanAmountInput, amountForBox } from '@/lib/amountInput';
import AutoTextarea from '@/components/AutoTextarea';
import { EditorCard, EditorPanel, saved } from '@/components/listing-editor/EditorPanel';
import { NumberStepper, ChoiceCard, WizardShell, durationLabel } from './wizardKit';
import { Field, SheetFooter, useCardSheet, inputCls } from './editorSheet';
import { ImageIcon, Image as ImageIconLucide } from 'lucide-react';

// The experience listing's items — the shared MenuRow shape, the add flow (a
// stepped wizard reusing the sign-up components) and the edit page (a page of
// raised cards, one per detail). ProviderListingEditor owns the array and its
// save; these only produce / edit one MenuRow and hand it back.

export type MenuRow = { id?: string; name: string; description: string; price: string; unit: string; image: string | null; duration: string; fulfilment: string | null; active: boolean; capacity: string; minPeople: string; includedGuests: string; extraAdultFee: string; extraChildFee: string; maxParty: string; isCustom: boolean; ingredients: string; allergens: string; category: string };

export type ItemCtx = { isSlot: boolean; shape: string; fulfilment: string; minAge: string; maxGuests: number; supabase: SupabaseClient };

export function rowFromItem(it: { id: string; name: string; description: string; price: number; unit: string; image: string | null; duration_minutes: number | null; fulfilment: string | null; active: boolean; capacity: number | null; min_people: number | null; included_guests?: number | null; extra_adult_fee?: number | null; extra_child_fee?: number | null; max_party?: number | null; is_custom?: boolean; ingredients?: string | null; allergens?: string | null; category?: string | null }): MenuRow {
    return {
        id: it.id, name: it.name, description: it.description, price: amountForBox(it.price),
        unit: it.unit, image: it.image, duration: it.duration_minutes != null ? String(it.duration_minutes) : '',
        fulfilment: it.fulfilment, active: it.active,
        capacity: it.capacity != null ? String(it.capacity) : '',
        minPeople: it.min_people != null ? String(it.min_people) : '',
        includedGuests: it.included_guests != null ? String(it.included_guests) : '',
        extraAdultFee: amountForBox(it.extra_adult_fee ?? null),
        extraChildFee: amountForBox(it.extra_child_fee ?? null),
        maxParty: it.max_party != null ? String(it.max_party) : '',
        isCustom: !!it.is_custom,
        ingredients: it.ingredients || '', allergens: it.allergens || '', category: it.category || '',
    };
}

export function newRow(isSlot: boolean, fulfilment: string): MenuRow {
    return { name: '', description: '', price: '', unit: isSlot ? 'person' : 'flat', image: null,
        duration: isSlot ? '60' : '', fulfilment: (isSlot && fulfilment === 'both') ? 'collection' : null, active: true,
        capacity: '', minPeople: '', includedGuests: '', extraAdultFee: '', extraChildFee: '', maxParty: '',
        isCustom: false, ingredients: '', allergens: '', category: '' };
}

export const unitLabel = (unit: string): string => (
    { flat: 'per session', person: 'per person', hour: 'per hour', night: 'per night', ticket: 'per ticket', item: 'per item' }[unit] || 'per session'
);

export function itemSummary(r: MenuRow, isSlot: boolean): string {
    const bits: string[] = [];
    bits.push(r.price ? `£${r.price} ${unitLabel(r.unit)}` : 'No price yet');
    if (isSlot && r.duration) bits.push(durationLabel(Number(r.duration)));
    if (!r.active) bits.push('hidden');
    return bits.join(' · ');
}

export async function uploadImage(supabase: SupabaseClient, file: File, prefix: string): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Please sign in again.', { theme: 'colored' }); return null; }
    try {
        const ready = await compressImage(file);
        const path = 'providers/' + prefix + '-' + user.id + '-' + Date.now() + '-' + generateRandomNumber() + '.jpg';
        const { error } = await supabase.storage.from(Env.S3_BUCKET).upload(path, ready, { contentType: 'image/jpeg' });
        if (error) { toast.error(error.message, { theme: 'colored' }); return null; }
        return path;
    } catch {
        toast.error('That image couldn’t be read. Try a different one.', { theme: 'colored' });
        return null;
    }
}

const chargeChoices = (r: { unit: string }): { v: string; l: string }[] => ([
    { v: 'person', l: 'Per person' }, { v: 'flat', l: 'Whole session' },
    ...(['hour', 'night', 'ticket', 'item'].includes(r.unit) ? [{ v: r.unit, l: unitLabel(r.unit) }] : []),
]);

// A big photo picker, shared by the add flow and the Photo edit card.
function PhotoPicker({ ctx, image, onChange }: { ctx: ItemCtx; image: string | null; onChange: (k: string | null) => void }) {
    const [uploading, setUploading] = useState(false);
    const change = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = (e.target.files || [])[0];
        e.target.value = '';
        if (!file) return;
        setUploading(true);
        const k = await uploadImage(ctx.supabase, file, 'item');
        if (k) onChange(k);
        setUploading(false);
    };
    return (
        <div>
            <label className="group relative block cursor-pointer">
                {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={getImageUrl(image)} alt="" className="h-56 w-full rounded-2xl object-cover ring-1 ring-slate-200" />
                ) : (
                    <span className="flex h-56 w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-300 text-slate-400">
                        <ImageIcon className="h-8 w-8" />
                        <span className="text-sm font-medium">{uploading ? 'Uploading…' : 'Add photo'}</span>
                    </span>
                )}
                {image && <span className="absolute inset-x-0 bottom-0 rounded-b-2xl bg-black/45 py-2 text-center text-sm font-semibold text-white opacity-0 transition group-hover:opacity-100">Change photo</span>}
                <input type="file" accept="image/png, image/jpeg" onChange={change} className="hidden" disabled={uploading} />
            </label>
            {image && <button type="button" onClick={() => onChange(null)} className="mt-2 text-sm text-slate-500 hover:text-red-600">Remove photo</button>}
        </div>
    );
}

// ── The add flow: one question per screen, a progress bar, Back/Next ──────────
export function AddItemFlow({ ctx, onClose, onAdd }: { ctx: ItemCtx; onClose: () => void; onAdd: (row: MenuRow) => unknown }) {
    const [r, setR] = useState<MenuRow>(newRow(ctx.isSlot, ctx.fulfilment));
    const [idx, setIdx] = useState(0);
    const [busy, setBusy] = useState(false);
    const set = (patch: Partial<MenuRow>) => setR((cur) => ({ ...cur, ...patch }));

    type StepKey = 'name' | 'photo' | 'price' | 'duration' | 'capacity' | 'party' | 'describe' | 'review';
    const steps: StepKey[] = ['name', 'photo', 'price'];
    if (ctx.isSlot) steps.push('duration');
    if (r.unit === 'person') steps.push(ctx.isSlot ? 'capacity' : 'party');
    steps.push('describe', 'review');
    const safeIdx = Math.min(idx, steps.length - 1);
    const key = steps[safeIdx];
    const isReview = key === 'review';

    const valid = (): boolean => {
        if (key === 'name') return !!r.name.trim();
        if (key === 'price') return Number(r.price) > 0;
        return true;
    };

    const next = async () => {
        if (!isReview) { setIdx(safeIdx + 1); return; }
        if (busy) return;
        setBusy(true);
        try { if (await saved(onAdd(r))) onClose(); } finally { setBusy(false); }
    };
    const back = safeIdx === 0 ? undefined : () => setIdx(safeIdx - 1);

    const titles: Record<StepKey, string> = {
        name: 'What’s it called?', photo: 'Add a photo', price: 'How much is it?',
        duration: 'How long does it last?', capacity: 'How many people can it take?',
        party: 'What’s the smallest party?', describe: 'Describe it', review: 'Review your item',
    };

    return (
        <WizardShell step={safeIdx + 1} total={steps.length} title={titles[key]}
            subtitle={key === 'describe' ? 'Optional — you can skip this.' : undefined}
            onClose={onClose} onBack={back} onNext={next} nextDisabled={busy || !valid()} nextLabel={isReview ? 'Add item' : 'Next'}>

            {key === 'name' && (
                <input autoFocus className="w-full border-0 border-b-2 border-slate-200 bg-transparent pb-3 text-center text-2xl font-semibold text-slate-900 placeholder:text-slate-300 focus:border-emerald-600 focus:outline-none"
                    placeholder="e.g. 90-minute private sauna" value={r.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
            )}

            {key === 'photo' && (
                <div className="mx-auto w-full max-w-md"><PhotoPicker ctx={ctx} image={r.image} onChange={(k) => set({ image: k })} /></div>
            )}

            {key === 'price' && (
                <div className="mx-auto w-full max-w-md space-y-6">
                    <div className="grid grid-cols-2 gap-3">
                        {chargeChoices(r).map((o) => (
                            <ChoiceCard key={o.v} selected={r.unit === o.v} onSelect={() => set({ unit: o.v })} title={o.l} hint={o.v === 'person' ? 'A price each' : 'One price for the booking'} />
                        ))}
                    </div>
                    <label className="mx-auto flex max-w-[12rem] items-center gap-2 border-b-2 border-slate-200 pb-2 focus-within:border-emerald-600">
                        <span className="text-3xl font-extrabold text-slate-400">£</span>
                        <input autoFocus className="w-full bg-transparent text-center text-5xl font-extrabold tabular-nums text-slate-900 placeholder:text-slate-300 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            type="text" inputMode="decimal" placeholder="0" value={r.price} onChange={(e) => set({ price: cleanAmountInput(e.target.value) })} />
                    </label>
                </div>
            )}

            {key === 'duration' && (
                <div className="flex justify-center">
                    <NumberStepper value={r.duration} onChange={(v) => set({ duration: v })} min={15} max={480} step={15} suggestion={60} size="lg" solid format={durationLabel} />
                </div>
            )}

            {key === 'capacity' && (
                <div className="flex flex-col items-center gap-3">
                    <NumberStepper value={r.capacity} onChange={(v) => set({ capacity: v })} min={1} max={60} suggestion={ctx.maxGuests} size="lg" solid suffix="people" />
                    <p className="text-sm text-slate-500">Blank uses your default of {ctx.maxGuests}.</p>
                </div>
            )}

            {key === 'party' && (
                <div className="flex flex-col items-center gap-3">
                    <NumberStepper value={r.minPeople} onChange={(v) => set({ minPeople: v })} min={1} max={60} suggestion={1} size="lg" solid suffix="guests" />
                    <p className="text-sm text-slate-500">The fewest you’ll take. Blank means one is fine.</p>
                </div>
            )}

            {key === 'describe' && (
                <div className="mx-auto w-full max-w-md">
                    <AutoTextarea className={inputCls} rows={4} placeholder="A line or two a guest reads before booking." value={r.description} onChange={(e) => set({ description: e.target.value })} />
                </div>
            )}

            {isReview && (
                <div className="mx-auto w-full max-w-md space-y-4">
                    {r.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={getImageUrl(r.image)} alt="" className="h-44 w-full rounded-2xl object-cover ring-1 ring-slate-200" />
                    ) : (
                        <div className="flex h-24 w-full items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><ImageIconLucide className="h-7 w-7" /></div>
                    )}
                    <div className="rounded-2xl border border-slate-200 p-4">
                        <div className="text-lg font-bold text-slate-900">{r.name || 'Untitled item'}</div>
                        <div className="mt-1 text-sm text-slate-600">{itemSummary(r, ctx.isSlot)}</div>
                        {r.unit === 'person' && ctx.isSlot && <div className="mt-0.5 text-sm text-slate-500">Capacity: {r.capacity || `default (${ctx.maxGuests})`} people</div>}
                        {r.description.trim() && <p className="mt-2 text-sm text-slate-500">{r.description}</p>}
                    </div>
                </div>
            )}
        </WizardShell>
    );
}

// ── The edit page: a page of raised cards, one per detail ────────────────────
function PhotoCard({ ctx, row, onSave }: { ctx: ItemCtx; row: MenuRow; onSave: (r: MenuRow) => unknown }) {
    const c = useCardSheet(row.image, (img) => onSave({ ...row, image: img }));
    return (
        <>
            <EditorCard title="Photo" summary={row.image ? 'Photo added' : 'None yet'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Photo" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <PhotoPicker ctx={ctx} image={c.draft} onChange={c.setDraft} />
                </EditorPanel>
            )}
        </>
    );
}

function NameCard({ row, onSave }: { row: MenuRow; onSave: (r: MenuRow) => unknown }) {
    const c = useCardSheet(row.name, (v) => onSave({ ...row, name: v }));
    return (
        <>
            <EditorCard title="Name" summary={row.name.trim() || 'Add a name'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Name" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <Field label="Name"><input className={inputCls} value={c.draft} maxLength={80} onChange={(e) => c.setDraft(e.target.value)} placeholder="e.g. 90-minute private sauna" /></Field>
                </EditorPanel>
            )}
        </>
    );
}

function PriceCard({ row, perItemLocation, onSave }: { row: MenuRow; perItemLocation: boolean; onSave: (r: MenuRow) => unknown }) {
    const c = useCardSheet({ price: row.price, unit: row.unit, fulfilment: row.fulfilment }, (d) => onSave({ ...row, ...d }));
    const travelled = perItemLocation && c.draft.fulfilment === 'delivery';
    return (
        <>
            <EditorCard title="Price" summary={row.price ? `£${row.price} ${unitLabel(row.unit)}` : 'Add a price'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Price" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-4">
                        {perItemLocation && (
                            <Field label="This one happens">
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => c.setDraft({ ...c.draft, fulfilment: 'collection' })}
                                        className={`rounded-xl border px-3 py-2 text-sm transition ${(c.draft.fulfilment || 'collection') === 'collection' ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>At my place</button>
                                    <button type="button" onClick={() => c.setDraft({ ...c.draft, fulfilment: 'delivery', unit: 'flat' })}
                                        className={`rounded-xl border px-3 py-2 text-sm transition ${c.draft.fulfilment === 'delivery' ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>I travel to them</button>
                                </div>
                            </Field>
                        )}
                        {!travelled && (
                            <Field label="Charged">
                                <div className="flex flex-wrap gap-2">
                                    {chargeChoices(c.draft).map((o) => (
                                        <button key={o.v} type="button" onClick={() => c.setDraft({ ...c.draft, unit: o.v })}
                                            className={`rounded-xl border px-4 py-2 text-sm transition ${c.draft.unit === o.v ? 'border-emerald-700 ring-2 ring-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>{o.l}</button>
                                    ))}
                                </div>
                            </Field>
                        )}
                        <Field label="Price">
                            <div className="flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-3 focus-within:border-slate-500">
                                <span className="text-slate-500">£</span>
                                <input className="w-full border-0 bg-transparent p-0 text-sm outline-none" type="text" inputMode="decimal" placeholder="0" value={c.draft.price} onChange={(e) => c.setDraft({ ...c.draft, price: cleanAmountInput(e.target.value) })} />
                            </div>
                        </Field>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

function StepperCard({ title, summary, value, suggestion, suffix, min, step, format, onSave }: {
    title: string; summary: string; value: string; suggestion: number; suffix?: string; min: number; step?: number; format?: (n: number) => string; onSave: (v: string) => unknown;
}) {
    const c = useCardSheet(value, onSave);
    return (
        <>
            <EditorCard title={title} summary={summary} onClick={c.start} />
            {c.open && (
                <EditorPanel title={title} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="flex justify-center py-4">
                        <NumberStepper value={c.draft} onChange={c.setDraft} min={min} max={format ? 480 : 60} step={step || 1} suggestion={suggestion} size="lg" solid suffix={suffix} format={format} />
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

function TextDetailCard({ title, placeholder, value, empty, onSave }: { title: string; placeholder?: string; value: string; empty: string; onSave: (v: string) => unknown }) {
    const c = useCardSheet(value, onSave);
    return (
        <>
            <EditorCard title={title} summary={value.trim() || empty} onClick={c.start} />
            {c.open && (
                <EditorPanel title={title} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <AutoTextarea className={inputCls} rows={3} placeholder={placeholder} value={c.draft} onChange={(e) => c.setDraft(e.target.value)} />
                </EditorPanel>
            )}
        </>
    );
}

function AvailableCard({ row, onSave }: { row: MenuRow; onSave: (r: MenuRow) => unknown }) {
    const c = useCardSheet(row.active, (v) => onSave({ ...row, active: v }));
    return (
        <>
            <EditorCard title="Available to book" summary={row.active ? 'Available' : 'Hidden'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Available to book" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <label className="flex items-center justify-between gap-4">
                        <span className="text-sm font-semibold text-slate-800">Guests can book this</span>
                        <button type="button" role="switch" aria-checked={c.draft} aria-label="Available to book" onClick={() => c.setDraft(!c.draft)}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${c.draft ? 'bg-emerald-700' : 'bg-slate-300'}`}>
                            <span className={`mt-0.5 inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${c.draft ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                    </label>
                </EditorPanel>
            )}
        </>
    );
}

// Extra-guest pricing (whole-session), standard/custom, menu section and
// ingredients kept as cards so nothing that affects booking becomes uneditable.
function StandardCustomCard({ row, onSave }: { row: MenuRow; onSave: (r: MenuRow) => unknown }) {
    const c = useCardSheet(row.isCustom, (v) => onSave({ ...row, isCustom: v }));
    return (
        <>
            <EditorCard title="This item is" summary={row.isCustom ? 'Custom — you approve first' : 'Standard — books instantly'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="This item is" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => c.setDraft(false)} className={`rounded-full border px-3 py-1.5 text-sm transition ${!c.draft ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}>Standard — books instantly</button>
                        <button type="button" onClick={() => c.setDraft(true)} className={`rounded-full border px-3 py-1.5 text-sm transition ${c.draft ? 'border-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}>Custom — you approve first</button>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

function ExtraGuestsCard({ row, minAge, onSave }: { row: MenuRow; minAge: string; onSave: (r: MenuRow) => unknown }) {
    const c = useCardSheet({ includedGuests: row.includedGuests, extraAdultFee: row.extraAdultFee, extraChildFee: row.extraChildFee, maxParty: row.maxParty },
        (d) => onSave({ ...row, ...d }));
    const summary = row.includedGuests ? `Includes ${row.includedGuests}, +£${row.extraAdultFee || 0}/adult` : 'One flat price';
    return (
        <>
            <EditorCard title="Extra guest pricing" summary={summary} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Extra guest pricing" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-3">
                        <Field label="Guests included"><input className="w-24 rounded-xl border border-slate-300 p-2.5 text-sm" type="text" inputMode="numeric" placeholder="—" value={c.draft.includedGuests} onChange={(e) => c.setDraft({ ...c.draft, includedGuests: cleanAmountInput(e.target.value, false) })} /></Field>
                        <Field label="Price per extra adult"><div className="flex items-center gap-1"><span className="text-slate-500">£</span><input className="w-24 rounded-xl border border-slate-300 p-2.5 text-sm" type="text" inputMode="decimal" placeholder="0" value={c.draft.extraAdultFee} onChange={(e) => c.setDraft({ ...c.draft, extraAdultFee: cleanAmountInput(e.target.value) })} /></div></Field>
                        {childrenAllowed(Number(minAge) || null) && (
                            <Field label="Price per extra child"><div className="flex items-center gap-1"><span className="text-slate-500">£</span><input className="w-24 rounded-xl border border-slate-300 p-2.5 text-sm" type="text" inputMode="decimal" placeholder="0" value={c.draft.extraChildFee} onChange={(e) => c.setDraft({ ...c.draft, extraChildFee: cleanAmountInput(e.target.value) })} /></div></Field>
                        )}
                        <Field label="Maximum group size"><input className="w-24 rounded-xl border border-slate-300 p-2.5 text-sm" type="text" inputMode="numeric" placeholder="—" value={c.draft.maxParty} onChange={(e) => c.setDraft({ ...c.draft, maxParty: cleanAmountInput(e.target.value, false) })} /></Field>
                        <p className="text-xs text-slate-400">Leave blank for one flat price. The price never drops below the base.</p>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

// The item card on the Pricing page; tapping it opens the detail page of cards.
export function ItemDetailCard({ ctx, row, onSave, onDelete }: { ctx: ItemCtx; row: MenuRow; onSave: (r: MenuRow) => unknown; onDelete: () => unknown }) {
    const [open, setOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const perItemLocation = ctx.isSlot && ctx.fulfilment === 'both';
    const perPerson = row.unit === 'person';
    const capSummary = row.capacity ? `${row.capacity} people` : `Default (${ctx.maxGuests})`;
    const partySummary = row.minPeople ? `${row.minPeople} guests` : 'One is fine';
    return (
        <>
            <EditorCard title={row.name.trim() || 'Untitled item'} summary={itemSummary(row, ctx.isSlot)} onClick={() => setOpen(true)} />
            {open && (
                <EditorPanel title={row.name.trim() || 'Item'} onClose={() => setOpen(false)}>
                    <div className="space-y-4">
                        <PhotoCard ctx={ctx} row={row} onSave={onSave} />
                        <NameCard row={row} onSave={onSave} />
                        <PriceCard row={row} perItemLocation={perItemLocation} onSave={onSave} />
                        {ctx.isSlot && (
                            <StepperCard title="Duration" summary={row.duration ? durationLabel(Number(row.duration)) : 'Not set'} value={row.duration} suggestion={60} min={15} step={15} format={durationLabel}
                                onSave={(v) => onSave({ ...row, duration: v })} />
                        )}
                        {ctx.isSlot && perPerson && (
                            <StepperCard title="Capacity" summary={capSummary} value={row.capacity} suggestion={ctx.maxGuests} suffix="people" min={1}
                                onSave={(v) => onSave({ ...row, capacity: v })} />
                        )}
                        {!ctx.isSlot && perPerson && (
                            <StepperCard title="Smallest party" summary={partySummary} value={row.minPeople} suggestion={1} suffix="guests" min={1}
                                onSave={(v) => onSave({ ...row, minPeople: v })} />
                        )}
                        {row.unit === 'flat' && <ExtraGuestsCard row={row} minAge={ctx.minAge} onSave={onSave} />}
                        <TextDetailCard title="Description" placeholder="A line or two a guest reads before booking." value={row.description} empty="Add a description" onSave={(v) => onSave({ ...row, description: v })} />
                        {ctx.shape === 'made_to_order' && <StandardCustomCard row={row} onSave={onSave} />}
                        {ctx.shape === 'made_to_order' && <TextDetailCard title="Menu section" placeholder="e.g. Cakes" value={row.category} empty="None" onSave={(v) => onSave({ ...row, category: v })} />}
                        {ctx.shape === 'made_to_order' && <TextDetailCard title="Ingredients" placeholder="e.g. Wheat flour, butter, eggs…" value={row.ingredients} empty="Not added" onSave={(v) => onSave({ ...row, ingredients: v })} />}
                        {ctx.shape === 'made_to_order' && <TextDetailCard title="Allergens" placeholder="e.g. Contains wheat, egg, milk…" value={row.allergens} empty="Not added" onSave={(v) => onSave({ ...row, allergens: v })} />}
                        <AvailableCard row={row} onSave={onSave} />

                        <div className="border-t border-slate-100 pt-4">
                            {confirmDelete ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                                    <p className="text-sm font-semibold text-rose-900">Delete this item?</p>
                                    <p className="mt-0.5 text-xs text-rose-800">It comes off your listing straight away.</p>
                                    <div className="mt-3 flex justify-end gap-3">
                                        <button type="button" onClick={() => setConfirmDelete(false)} className="text-sm font-semibold text-slate-900 underline">Cancel</button>
                                        <button type="button" onClick={async () => { await onDelete(); setOpen(false); }} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">Delete</button>
                                    </div>
                                </div>
                            ) : (
                                <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm font-semibold text-rose-600 hover:text-rose-700">Delete this item</button>
                            )}
                        </div>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}
