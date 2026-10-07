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
import { NumberStepper, ChoiceCard, ChoiceTiles, WizardShell, BigAmountInput, BigTextInput, durationLabel, wizardAreaCls } from './wizardKit';
import { Field, SheetFooter, useCardSheet, inputCls } from './editorSheet';
import { ImageIcon, Image as ImageIconLucide, User, Users, Trash2, Check } from 'lucide-react';
import { SinglePhotoSheet, ConfirmRemove } from './SinglePhotoSheet';

// The experience listing's items — the shared MenuRow shape, the add flow (a
// stepped wizard reusing the sign-up components) and the edit page (a page of
// raised cards, one per detail). ProviderListingEditor owns the array and its
// save; these only produce / edit one MenuRow and hand it back.

export type MenuRow = { id?: string; name: string; description: string; price: string; priceMode: string; priceMax: string; unit: string; image: string | null; duration: string; fulfilment: string | null; active: boolean; capacity: string; minPeople: string; includedGuests: string; extraAdultFee: string; extraChildFee: string; maxParty: string; isCustom: boolean; ingredients: string; allergens: string; category: string };

export type ItemCtx = { isSlot: boolean; shape: string; fulfilment: string; minAge: string; maxGuests: number; supabase: SupabaseClient };

export function rowFromItem(it: { id: string; name: string; description: string; price: number; price_mode?: string | null; price_max?: number | null; unit: string; image: string | null; duration_minutes: number | null; fulfilment: string | null; active: boolean; capacity: number | null; min_people: number | null; included_guests?: number | null; extra_adult_fee?: number | null; extra_child_fee?: number | null; max_party?: number | null; is_custom?: boolean; ingredients?: string | null; allergens?: string | null; category?: string | null }): MenuRow {
    return {
        id: it.id, name: it.name, description: it.description, price: amountForBox(it.price),
        priceMode: (['fixed', 'range', 'enquiry'].indexOf(String(it.price_mode)) !== -1 ? String(it.price_mode) : 'fixed'),
        priceMax: amountForBox(it.price_max ?? null),
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
    return { name: '', description: '', price: '', priceMode: 'fixed', priceMax: '', unit: isSlot ? 'person' : 'flat', image: null,
        duration: isSlot ? '60' : '', fulfilment: (isSlot && fulfilment === 'both') ? 'collection' : null, active: true,
        capacity: '', minPeople: '', includedGuests: '', extraAdultFee: '', extraChildFee: '', maxParty: '',
        isCustom: false, ingredients: '', allergens: '', category: '' };
}

export const unitLabel = (unit: string): string => (
    { flat: 'per session', person: 'per person', hour: 'per hour', night: 'per night', ticket: 'per ticket', item: 'per item' }[unit] || 'per session'
);

export function itemSummary(r: MenuRow, isSlot: boolean): string {
    const bits: string[] = [];
    const mode = r.priceMode || 'fixed';
    if (mode === 'enquiry') bits.push('Price on enquiry');
    else if (mode === 'range' && r.price && r.priceMax) bits.push(`£${r.price}–£${r.priceMax} ${unitLabel(r.unit)}`);
    else bits.push(r.price ? `£${r.price} ${unitLabel(r.unit)}` : 'No price yet');
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

// The price, in the sign-up wizard's style and with its components: the big £
// amount in the middle, then two large tiles with icons — Per person and Whole
// session. Shared by the add flow and the Price edit sheet, so both read the
// same. An older offering priced another way (per hour, per night…) keeps that
// as a third tile, so it's never silently changed. `units: false` hides the
// tiles (a travelling offering is always one price for the booking).
// A compact "£ amount" box for the two ends of a range, where the single big
// BigAmountInput would be too large shown twice.
function RangeAmount({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <label className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <span className="flex items-center gap-1 rounded-xl border-2 border-slate-200 px-3 py-2 focus-within:border-emerald-600">
                <span className="text-xl font-bold text-slate-400">£</span>
                <input type="text" inputMode="decimal" autoComplete="off" value={value}
                    onChange={(e) => onChange(cleanAmountInput(e.target.value))}
                    className="w-20 bg-transparent text-center text-2xl font-extrabold tabular-nums text-slate-900 placeholder:text-slate-300 focus:outline-none" placeholder="0" />
            </span>
        </label>
    );
}

// The price, in the sign-up wizard's style. A mode toggle at the top — one price,
// a range, or price on enquiry — then the amount(s) and the per-person/whole-
// session tiles (hidden for enquiry, which has no figure to charge). Shared by
// the add flow and the Price edit sheet so both read the same. `onMode` is
// optional: a caller that doesn't pass it keeps the old single-price control.
function PriceChoice({ price, unit, mode = 'fixed', priceMax = '', onPrice, onUnit, onMode, onPriceMax, units = true, autoFocus }: {
    price: string; unit: string; mode?: string; priceMax?: string;
    onPrice: (v: string) => void; onUnit: (u: string) => void;
    onMode?: (m: string) => void; onPriceMax?: (v: string) => void;
    units?: boolean; autoFocus?: boolean;
}) {
    const icon = (v: string) => (v === 'person' ? User : v === 'flat' ? Users : undefined);
    const hint = (v: string) => (v === 'person' ? 'A price each' : v === 'flat' ? 'One price for the booking' : 'As it’s priced now');
    const m = mode || 'fixed';
    return (
        <div className="mx-auto w-full max-w-md space-y-8">
            {onMode && (
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="How it’s priced">
                    {[['fixed', 'One price'], ['range', 'A range'], ['enquiry', 'On enquiry']].map(([v, l]) => (
                        <button key={v} type="button" role="radio" aria-checked={m === v} onClick={() => onMode(v)}
                            className={'rounded-xl border-2 px-3 py-2 text-sm font-semibold transition '
                                + (m === v ? 'border-emerald-600 bg-emerald-50/60 text-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
                            {l}
                        </button>
                    ))}
                </div>
            )}

            {m === 'enquiry' ? (
                <p className="text-center text-sm text-slate-500 [text-wrap:balance]">
                    You’ll agree the price with the guest when they message you. Guests see “Price on enquiry”.
                </p>
            ) : m === 'range' ? (
                <div className="flex items-end justify-center gap-4">
                    <RangeAmount label="From" value={price} onChange={(v) => onPrice(v)} />
                    <span className="pb-3 text-lg text-slate-400">–</span>
                    <RangeAmount label="To" value={priceMax} onChange={(v) => (onPriceMax ? onPriceMax(v) : undefined)} />
                </div>
            ) : (
                <BigAmountInput value={price} numeric={false} autoFocus={autoFocus} ariaLabel="Price"
                    onChange={(v) => onPrice(cleanAmountInput(v))} />
            )}

            {units && m !== 'enquiry' && (
                <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="How it’s charged">
                    {chargeChoices({ unit }).map((o) => (
                        <ChoiceCard key={o.v} radio selected={unit === o.v} onSelect={() => onUnit(o.v)} title={o.l} hint={hint(o.v)} icon={icon(o.v)} />
                    ))}
                </div>
            )}
        </div>
    );
}

// Whether a row's price step is complete, by mode: a fixed price > 0, a range
// with a from and a larger to, or enquiry (nothing to fill).
export function priceRowValid(r: { price: string; priceMode?: string; priceMax?: string }): boolean {
    const m = r.priceMode || 'fixed';
    if (m === 'enquiry') return true;
    if (m === 'range') return Number(r.price) > 0 && Number(r.priceMax) > Number(r.price);
    return Number(r.price) > 0;
}

// The add flow's photo step: a big tap-to-add tile, or the photo with a bin on
// it ("Remove this photo?"). Nothing is saved until the offering is added. The
// edit card uses SinglePhotoSheet, which saves as it goes.
function PhotoPicker({ ctx, image, onChange }: { ctx: ItemCtx; image: string | null; onChange: (k: string | null) => void }) {
    const [uploading, setUploading] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const change = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = (e.target.files || [])[0];
        e.target.value = '';
        if (!file) return;
        setUploading(true);
        const k = await uploadImage(ctx.supabase, file, 'item');
        if (k) onChange(k);
        setUploading(false);
    };
    if (image) {
        return (
            <div className="relative mx-auto w-fit max-w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={getImageUrl(image)} alt="" className="block h-auto max-h-[55vh] w-auto max-w-full rounded-2xl bg-slate-100 ring-1 ring-slate-200" />
                <button type="button" onClick={() => setConfirming(true)} aria-label="Remove this photo"
                    className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow">
                    <Trash2 className="h-4 w-4" />
                </button>
                {confirming && <ConfirmRemove body="It won’t be added with this offering." onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); onChange(null); }} />}
            </div>
        );
    }
    return (
        <label className="block cursor-pointer">
            <span className="flex h-56 w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-300 text-slate-400">
                <ImageIcon className="h-8 w-8" />
                <span className="text-sm font-medium">{uploading ? 'Uploading…' : 'Add photo'}</span>
            </span>
            <input type="file" accept="image/png, image/jpeg" onChange={change} className="hidden" disabled={uploading} />
        </label>
    );
}

// ── The add flow: one question per screen, a progress bar, Back/Next ──────────
// The add flow's questions — the edit sheets ask the same ones, so "What's it
// called?" reads the same whether adding or editing.
const STEP_QUESTIONS = {
    name: 'What’s it called?', photo: 'Add a photo', price: 'How much is it?',
    duration: 'How long does it last?', capacity: 'How many people can it take?',
    party: 'What’s the smallest party?', describe: 'Describe it',
} as const;

export function AddItemFlow({ ctx, onClose, onAdd }: { ctx: ItemCtx; onClose: () => void; onAdd: (row: MenuRow) => unknown }) {
    const [r, setR] = useState<MenuRow>(newRow(ctx.isSlot, ctx.fulfilment));
    const [idx, setIdx] = useState(0);
    const [busy, setBusy] = useState(false);
    const set = (patch: Partial<MenuRow>) => setR((cur) => ({ ...cur, ...patch }));

    type StepKey = 'name' | 'photo' | 'price' | 'duration' | 'capacity' | 'party' | 'describe' | 'review';
    // The same order as an offering's cards: Name, Price, Duration, Capacity,
    // Description, Photo.
    const steps: StepKey[] = ['name', 'price'];
    if (ctx.isSlot) steps.push('duration');
    if (r.unit === 'person') steps.push(ctx.isSlot ? 'capacity' : 'party');
    steps.push('describe', 'photo', 'review');
    const safeIdx = Math.min(idx, steps.length - 1);
    const key = steps[safeIdx];
    const isReview = key === 'review';

    const valid = (): boolean => {
        if (key === 'name') return !!r.name.trim();
        if (key === 'price') return priceRowValid(r);
        return true;
    };

    const next = async () => {
        if (!isReview) { setIdx(safeIdx + 1); return; }
        if (busy) return;
        setBusy(true);
        try { if (await saved(onAdd(r))) onClose(); } finally { setBusy(false); }
    };
    const back = safeIdx === 0 ? undefined : () => setIdx(safeIdx - 1);

    const titles: Record<StepKey, string> = { ...STEP_QUESTIONS, review: 'Review your offering' };

    return (
        <WizardShell step={safeIdx + 1} total={steps.length} title={titles[key]}
            subtitle={key === 'describe' ? 'Optional — you can skip this.' : undefined}
            onClose={onClose} onBack={back} onNext={next} nextDisabled={busy || !valid()} nextLabel={isReview ? 'Add offering' : 'Next'}>

            {key === 'name' && (
                <BigTextInput autoFocus ariaLabel="What’s it called?" placeholder="e.g. 90-minute private sauna" value={r.name} onChange={(v) => set({ name: v })} />
            )}

            {key === 'photo' && (
                <div className="mx-auto w-full max-w-md"><PhotoPicker ctx={ctx} image={r.image} onChange={(k) => set({ image: k })} /></div>
            )}

            {key === 'price' && (
                <PriceChoice price={r.price} unit={r.unit} mode={r.priceMode} priceMax={r.priceMax} autoFocus
                    onPrice={(v) => set({ price: v })} onUnit={(u) => set({ unit: u })}
                    onMode={(mo) => set({ priceMode: mo })} onPriceMax={(v) => set({ priceMax: v })} />
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
                    <AutoTextarea className={wizardAreaCls} rows={4} placeholder="A line or two a guest reads before booking." aria-label="Describe it" value={r.description} onChange={(e) => set({ description: e.target.value })} />
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
                        <div className="text-lg font-bold text-slate-900">{r.name || 'Untitled offering'}</div>
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
    const [open, setOpen] = useState(false);
    return (
        <>
            <EditorCard title="Photo" summary={row.image ? 'Photo added' : 'None yet'} onClick={() => setOpen(true)} />
            {open && (
                <SinglePhotoSheet emptyTitle={STEP_QUESTIONS.photo} title="Photo" image={row.image} onClose={() => setOpen(false)}
                    upload={(file) => uploadImage(ctx.supabase, file, 'item')}
                    onSave={(img) => onSave({ ...row, image: img })} />
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
                <EditorPanel title={STEP_QUESTIONS.name} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <BigTextInput autoFocus ariaLabel="What’s it called?" placeholder="e.g. 90-minute private sauna" value={c.draft} onChange={c.setDraft} />
                </EditorPanel>
            )}
        </>
    );
}

function PriceCard({ row, perItemLocation, onSave }: { row: MenuRow; perItemLocation: boolean; onSave: (r: MenuRow) => unknown }) {
    const c = useCardSheet({ price: row.price, unit: row.unit, fulfilment: row.fulfilment, priceMode: row.priceMode || 'fixed', priceMax: row.priceMax || '' }, (d) => onSave({ ...row, ...d }));
    const travelled = perItemLocation && c.draft.fulfilment === 'delivery';
    const priceSummary = (row.priceMode || 'fixed') === 'enquiry'
        ? 'Price on enquiry'
        : (row.priceMode === 'range' && row.price && row.priceMax)
            ? `£${row.price}–£${row.priceMax} ${unitLabel(row.unit)}`
            : (row.price ? `£${row.price} ${unitLabel(row.unit)}` : 'Add a price');
    return (
        <>
            <EditorCard title="Price" summary={priceSummary} onClick={c.start} />
            {c.open && (
                <EditorPanel title={STEP_QUESTIONS.price} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-4">
                        {perItemLocation && (
                            <ChoiceTiles value={c.draft.fulfilment === 'delivery' ? 'delivery' : 'collection'}
                                onChange={(v) => c.setDraft(v === 'delivery' ? { ...c.draft, fulfilment: 'delivery', unit: 'flat' } : { ...c.draft, fulfilment: 'collection' })}
                                options={[{ value: 'collection', label: 'At my place' }, { value: 'delivery', label: 'I travel to them' }]} />
                        )}
                        <div className="py-4">
                            <PriceChoice price={c.draft.price} unit={c.draft.unit} units={!travelled}
                                mode={c.draft.priceMode} priceMax={c.draft.priceMax}
                                onPrice={(v) => c.setDraft({ ...c.draft, price: v })} onUnit={(u) => c.setDraft({ ...c.draft, unit: u })}
                                onMode={(mo) => c.setDraft({ ...c.draft, priceMode: mo })} onPriceMax={(v) => c.setDraft({ ...c.draft, priceMax: v })} />
                        </div>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

function StepperCard({ title, question, summary, value, suggestion, suffix, min, step, format, onSave }: {
    title: string; question: string; summary: string; value: string; suggestion: number; suffix?: string; min: number; step?: number; format?: (n: number) => string; onSave: (v: string) => unknown;
}) {
    const c = useCardSheet(value, onSave);
    return (
        <>
            <EditorCard title={title} summary={summary} onClick={c.start} />
            {c.open && (
                <EditorPanel title={question} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="flex justify-center py-4">
                        <NumberStepper value={c.draft} onChange={c.setDraft} min={min} max={format ? 480 : 60} step={step || 1} suggestion={suggestion} size="lg" solid suffix={suffix} format={format} />
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

function TextDetailCard({ title, question, placeholder, value, empty, onSave }: { title: string; question: string; placeholder?: string; value: string; empty: string; onSave: (v: string) => unknown }) {
    const c = useCardSheet(value, onSave);
    return (
        <>
            <EditorCard title={title} summary={value.trim() || empty} onClick={c.start} />
            {c.open && (
                <EditorPanel title={question} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <AutoTextarea className={wizardAreaCls} rows={3} placeholder={placeholder} aria-label={title} value={c.draft} onChange={(e) => c.setDraft(e.target.value)} />
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
                <EditorPanel title="Can guests book it?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <ChoiceTiles value={c.draft ? 'yes' : 'no'} onChange={(v) => c.setDraft(v === 'yes')}
                        options={[{ value: 'yes', label: 'Yes, it’s bookable' }, { value: 'no', label: 'No, hide it for now' }]} />
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
            <EditorCard title="This offering is" summary={row.isCustom ? 'Custom — you approve first' : 'Standard — books instantly'} onClick={c.start} />
            {c.open && (
                <EditorPanel title="Can guests book it straight away?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <ChoiceTiles value={c.draft ? 'custom' : 'standard'} onChange={(v) => c.setDraft(v === 'custom')}
                        options={[{ value: 'standard', label: 'Standard', hint: 'Books instantly' }, { value: 'custom', label: 'Custom', hint: 'You approve first' }]} />
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
                <EditorPanel title="Do extra guests pay more?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-5">
                        <Field label="Guests included"><input className="w-28 rounded-2xl border-2 border-slate-200 px-4 py-3 text-base text-slate-900 focus:border-emerald-600 focus:outline-none" type="text" inputMode="numeric" placeholder="—" value={c.draft.includedGuests} onChange={(e) => c.setDraft({ ...c.draft, includedGuests: cleanAmountInput(e.target.value, false) })} /></Field>
                        <Field label="Price per extra adult"><div className="flex items-center gap-1"><span className="text-base text-slate-700">£</span><input className="w-28 rounded-2xl border-2 border-slate-200 px-4 py-3 text-base text-slate-900 focus:border-emerald-600 focus:outline-none" type="text" inputMode="decimal" placeholder="0" value={c.draft.extraAdultFee} onChange={(e) => c.setDraft({ ...c.draft, extraAdultFee: cleanAmountInput(e.target.value) })} /></div></Field>
                        {childrenAllowed(Number(minAge) || null) && (
                            <Field label="Price per extra child"><div className="flex items-center gap-1"><span className="text-base text-slate-700">£</span><input className="w-28 rounded-2xl border-2 border-slate-200 px-4 py-3 text-base text-slate-900 focus:border-emerald-600 focus:outline-none" type="text" inputMode="decimal" placeholder="0" value={c.draft.extraChildFee} onChange={(e) => c.setDraft({ ...c.draft, extraChildFee: cleanAmountInput(e.target.value) })} /></div></Field>
                        )}
                        <Field label="Maximum group size"><input className="w-28 rounded-2xl border-2 border-slate-200 px-4 py-3 text-base text-slate-900 focus:border-emerald-600 focus:outline-none" type="text" inputMode="numeric" placeholder="—" value={c.draft.maxParty} onChange={(e) => c.setDraft({ ...c.draft, maxParty: cleanAmountInput(e.target.value, false) })} /></Field>
                        <p className="text-sm text-slate-600">Leave blank for one flat price. The price never drops below the base.</p>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

// The offering card under What you offer; tapping it opens the detail page of
// cards — or, while What you offer is in Edit mode, ticks it for deleting.
export function ItemDetailCard({ ctx, row, onSave, onDelete, selecting, selected, onToggle }: {
    ctx: ItemCtx; row: MenuRow; onSave: (r: MenuRow) => unknown; onDelete: () => unknown;
    selecting?: boolean; selected?: boolean; onToggle?: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const perItemLocation = ctx.isSlot && ctx.fulfilment === 'both';
    const perPerson = row.unit === 'person';
    const capSummary = row.capacity ? `${row.capacity} people` : `Default (${ctx.maxGuests})`;
    const partySummary = row.minPeople ? `${row.minPeople} guests` : 'One is fine';
    return (
        <>
            {selecting ? (
                <button type="button" role="checkbox" aria-checked={!!selected} onClick={onToggle}
                    className={`flex w-full items-center gap-4 rounded-2xl border bg-white p-5 text-left shadow-[0_6px_16px_rgba(0,0,0,0.12)] transition ${selected ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}>
                    <span aria-hidden className={`flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 ${selected ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white'}`}>
                        {selected && <Check className="h-4 w-4" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                        <span className="block font-semibold text-slate-900">{row.name.trim() || 'Untitled offering'}</span>
                        <span className="mt-0.5 block truncate text-sm text-slate-500">{itemSummary(row, ctx.isSlot)}</span>
                    </span>
                </button>
            ) : (
                <EditorCard title={row.name.trim() || 'Untitled offering'} summary={itemSummary(row, ctx.isSlot)} onClick={() => setOpen(true)} />
            )}
            {open && !selecting && (
                <EditorPanel title={row.name.trim() || 'Offering'} onClose={() => setOpen(false)}>
                    {/* Name, Price, Duration, Capacity, Description, Photo, Available to book. */}
                    <div className="space-y-4">
                        <NameCard row={row} onSave={onSave} />
                        <PriceCard row={row} perItemLocation={perItemLocation} onSave={onSave} />
                        {ctx.isSlot && (
                            <StepperCard title="Duration" question={STEP_QUESTIONS.duration} summary={row.duration ? durationLabel(Number(row.duration)) : 'Not set'} value={row.duration} suggestion={60} min={15} step={15} format={durationLabel}
                                onSave={(v) => onSave({ ...row, duration: v })} />
                        )}
                        {ctx.isSlot && perPerson && (
                            <StepperCard title="Capacity" question={STEP_QUESTIONS.capacity} summary={capSummary} value={row.capacity} suggestion={ctx.maxGuests} suffix="people" min={1}
                                onSave={(v) => onSave({ ...row, capacity: v })} />
                        )}
                        {!ctx.isSlot && perPerson && (
                            <StepperCard title="Smallest party" question={STEP_QUESTIONS.party} summary={partySummary} value={row.minPeople} suggestion={1} suffix="guests" min={1}
                                onSave={(v) => onSave({ ...row, minPeople: v })} />
                        )}
                        {row.unit === 'flat' && <ExtraGuestsCard row={row} minAge={ctx.minAge} onSave={onSave} />}
                        <TextDetailCard title="Description" question={STEP_QUESTIONS.describe} placeholder="A line or two a guest reads before booking." value={row.description} empty="Add a description" onSave={(v) => onSave({ ...row, description: v })} />
                        {ctx.shape === 'made_to_order' && <StandardCustomCard row={row} onSave={onSave} />}
                        {ctx.shape === 'made_to_order' && <TextDetailCard title="Menu section" question="Which part of your menu is it in?" placeholder="e.g. Cakes" value={row.category} empty="None" onSave={(v) => onSave({ ...row, category: v })} />}
                        {ctx.shape === 'made_to_order' && <TextDetailCard title="Ingredients" question="What’s in it?" placeholder="e.g. Wheat flour, butter, eggs…" value={row.ingredients} empty="Not added" onSave={(v) => onSave({ ...row, ingredients: v })} />}
                        {ctx.shape === 'made_to_order' && <TextDetailCard title="Allergens" question="Which allergens does it contain?" placeholder="e.g. Contains wheat, egg, milk…" value={row.allergens} empty="Not added" onSave={(v) => onSave({ ...row, allergens: v })} />}
                        <PhotoCard ctx={ctx} row={row} onSave={onSave} />
                        <AvailableCard row={row} onSave={onSave} />

                        <div className="border-t border-slate-100 pt-4">
                            {confirmDelete ? (
                                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                                    <p className="text-sm font-semibold text-rose-900">Delete this offering?</p>
                                    <p className="mt-0.5 text-xs text-rose-800">It comes off your listing straight away.</p>
                                    <div className="mt-3 flex justify-end gap-3">
                                        <button type="button" onClick={() => setConfirmDelete(false)} className="text-sm font-semibold text-slate-900 underline">Cancel</button>
                                        <button type="button" onClick={async () => { await onDelete(); setOpen(false); }} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700">Delete</button>
                                    </div>
                                </div>
                            ) : (
                                <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm font-semibold text-rose-600 hover:text-rose-700">Delete this offering</button>
                            )}
                        </div>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}
