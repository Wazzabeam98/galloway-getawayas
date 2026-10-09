'use client';

import { useState } from 'react';
import { toast } from 'react-toastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import Env from '@/config/Env';
import { getImageUrl, generateRandomNumber } from '@/lib/utils';
import { compressImage } from '@/lib/compressImage';
import { cleanAmountInput, amountForBox } from '@/lib/amountInput';
import AutoTextarea from '@/components/AutoTextarea';
import { EditorCard, EditorPanel, saved } from '@/components/listing-editor/EditorPanel';
import { NumberStepper, ChoiceCard, ChoiceTiles, WizardShell, BigAmountInput, BigTextInput, durationLabel, wizardAreaCls } from './wizardKit';
import { SheetFooter, useCardSheet } from './editorSheet';
import { ImageIcon, Image as ImageIconLucide, User, Users, CalendarDays, Package, Trash2, Check, Clock } from 'lucide-react';
import { UNIT_NAME, UNIT_HINT, unitChoices, unitPer, priceQuestion } from '@/lib/pricingUnits';
import { serviceCommission } from '@/lib/pricing';
import { SinglePhotoSheet, ConfirmRemove } from './SinglePhotoSheet';
import { VAT_TREATMENTS, normaliseVatTreatment } from '@/lib/vat';

// The experience listing's items — the shared MenuRow shape, the add flow (a
// stepped wizard reusing the sign-up components) and the edit page (a page of
// raised cards, one per detail). ProviderListingEditor owns the array and its
// save; these only produce / edit one MenuRow and hand it back.

export type MenuRow = { id?: string; name: string; description: string; price: string; groupPrice: string; minHours: string; unit: string; image: string | null; duration: string; fulfilment: string | null; active: boolean; capacity: string; minPeople: string; includedGuests: string; extraAdultFee: string; extraChildFee: string; maxParty: string; isCustom: boolean; ingredients: string; allergens: string; category: string; vatTreatment: string };

// vatRegistered: the provider is VAT registered, so each offering shows its VAT treatment card.
// units: the charge units this provider's offerings may use (lib/pricingUnits);
// timed: the one-at-a-time treatment shape (massage) — one unit, never asked,
// priced by its length; commissionRate: their real rate, for "You keep".
export type ItemCtx = { isSlot: boolean; shape: string; fulfilment: string; minAge: string; maxGuests: number; supabase: SupabaseClient; vatRegistered?: boolean; units: string[]; timed: boolean; commissionRate: number };

export function rowFromItem(it: { id: string; name: string; description: string; price: number; group_price?: number | null; min_hours?: number | null; unit: string; image: string | null; duration_minutes: number | null; fulfilment: string | null; active: boolean; capacity: number | null; min_people: number | null; included_guests?: number | null; extra_adult_fee?: number | null; extra_child_fee?: number | null; max_party?: number | null; is_custom?: boolean; ingredients?: string | null; allergens?: string | null; category?: string | null; vat_treatment?: string | null }): MenuRow {
    return {
        id: it.id, name: it.name, description: it.description, price: amountForBox(it.price),
        groupPrice: amountForBox(it.group_price ?? null),
        minHours: it.min_hours != null ? String(it.min_hours) : '',
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
        vatTreatment: normaliseVatTreatment(it.vat_treatment),
    };
}

export function newRow(isSlot: boolean, fulfilment: string, unit: string): MenuRow {
    return { name: '', description: '', price: '', groupPrice: '', minHours: '', unit, image: null,
        duration: isSlot ? '60' : '', fulfilment: (isSlot && fulfilment === 'both') ? 'collection' : null, active: true,
        capacity: '', minPeople: '', includedGuests: '', extraAdultFee: '', extraChildFee: '', maxParty: '',
        isCustom: false, ingredients: '', allergens: '', category: '', vatTreatment: 'standard' };
}

// "£30 per person", "£475 per event"; a timed treatment reads "£60" and its
// length follows in the summary.
function priceWords(price: string, unit: string, timed: boolean): string {
    if (!price) return 'No price yet';
    return timed ? `£${price}` : `£${price} ${unitPer(unit)}`;
}

export function itemSummary(r: MenuRow, isSlot: boolean, timed = false, shape = ''): string {
    const bits: string[] = [];
    bits.push(priceWords(r.price, shape === 'made_to_order' ? 'item' : r.unit, timed));
    if (r.unit === 'person' && Number(r.groupPrice) > 0) bits.push(`£${r.groupPrice} per group`);
    if (r.unit === 'hour' && Number(r.minHours) > 1) bits.push(`minimum ${r.minHours} hours`);
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

// The unit tiles, then the amount, then what the provider keeps. The unit comes
// first — "How much per person?" only makes sense once "per person" is chosen.
// Shared by the add flow and the Price edit sheet so both read the same. The
// tiles show only when there is a choice (a massage or a food menu has one
// unit); a row already on a legacy unit keeps it as its own tile so it is never
// silently changed. `units: false` hides them (a travelling offering is always
// one price for the booking).
const unitIcon = (v: string) => (v === 'person' ? User : v === 'flat' ? Users : v === 'event' ? CalendarDays : v === 'item' ? Package : v === 'hour' ? Clock : undefined);

function UnitTiles({ ctx, unit, onUnit }: { ctx: ItemCtx; unit: string; onUnit: (u: string) => void }) {
    const choices = unitChoices(ctx.units, unit);
    return (
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="How do you charge?">
            {choices.map((v) => (
                <ChoiceCard key={v} radio selected={unit === v} onSelect={() => onUnit(v)}
                    title={UNIT_NAME[v] || v} hint={UNIT_HINT[v] || 'As it’s priced now'} icon={unitIcon(v)} />
            ))}
        </div>
    );
}

// "You keep £27 per person" — the provider's own commission rate, worked out by
// the same function the order uses, so the figure is what they're really paid.
export function KeepLine({ price, unit, timed, rate }: { price: string; unit: string; timed: boolean; rate: number }) {
    const n = Number(price) || 0;
    if (!(n > 0)) return null;
    const keep = Math.max(0, n - serviceCommission(n, rate));
    const per = timed ? '' : unitPer(unit);
    return (
        <p className="text-center text-sm text-slate-600">
            You keep <span className="font-semibold text-slate-900">£{keep.toFixed(2)}</span>{per ? ' ' + per : ''}
            <span className="text-slate-400"> · after our {Math.round(rate * 100)}% commission</span>
        </p>
    );
}

// ONE OFFERING, TWO PRICES (Liam, 9 Oct 2026). A per-person offering can also be
// booked whole by one group at a group price — a sauna round at £18 a person, or
// the whole barrel for £90 — so the provider never creates the experience twice.
// Optional: blank means places only. Not for a timed treatment or a food menu.
export const offersGroupPrice = (ctx: ItemCtx, unit: string): boolean =>
    unit === 'person' && !ctx.timed && ctx.shape !== 'made_to_order';

function GroupPriceField({ ctx, value, onChange }: { ctx: ItemCtx; value: string; onChange: (v: string) => void }) {
    return (
        <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
            <div>
                <p className="font-semibold text-slate-900">{ctx.isSlot ? 'Can one group book the whole session?' : 'Can one group book it all?'}</p>
                <p className="mt-0.5 text-sm text-slate-600">Set a group price and guests can choose: a place each, or the whole thing for their group. The group pays it in full however many come, up to your maximum. Leave it blank for places only.</p>
            </div>
            <label className="flex items-center gap-2">
                <span className="text-lg font-bold text-slate-500">£</span>
                <input type="text" inputMode="decimal" autoComplete="off" placeholder="—" aria-label="Group price" value={value}
                    onChange={(e) => onChange(cleanAmountInput(e.target.value))}
                    className="w-32 rounded-2xl border-2 border-slate-200 px-4 py-3 text-base text-slate-900 focus:border-emerald-600 focus:outline-none" />
                <span className="text-sm text-slate-500">per group</span>
            </label>
            <KeepLine price={value} unit="flat" timed={false} rate={ctx.commissionRate} />
        </div>
    );
}

function PriceChoice({ ctx, price, unit, groupPrice, onPrice, onUnit, onGroupPrice, units = true, autoFocus }: {
    ctx: ItemCtx; price: string; unit: string; groupPrice?: string;
    onPrice: (v: string) => void; onUnit: (u: string) => void; onGroupPrice?: (v: string) => void;
    units?: boolean; autoFocus?: boolean;
}) {
    // A food menu is per item and a treatment is priced by its length — neither
    // is asked, even when an older row carries another unit.
    const showTiles = units && !ctx.timed && ctx.shape !== 'made_to_order' && unitChoices(ctx.units, unit).length > 1;
    return (
        <div className="mx-auto w-full max-w-md space-y-8">
            {showTiles && <UnitTiles ctx={ctx} unit={unit} onUnit={onUnit} />}
            <div className="space-y-3">
                {showTiles && <p className="text-center text-base font-semibold text-slate-900">{priceQuestion(unit)}</p>}
                <BigAmountInput value={price} numeric={false} autoFocus={autoFocus} ariaLabel="Price"
                    onChange={(v) => onPrice(cleanAmountInput(v))} />
            </div>
            <KeepLine price={price} unit={unit} timed={ctx.timed} rate={ctx.commissionRate} />
            {units && onGroupPrice && offersGroupPrice(ctx, unit) && (
                <GroupPriceField ctx={ctx} value={groupPrice || ''} onChange={onGroupPrice} />
            )}
        </div>
    );
}

// Whether a row's price step is complete: a price above zero.
export function priceRowValid(r: { price: string }): boolean {
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
    hours: 'What’s the fewest hours someone can book?',
} as const;

export function AddItemFlow({ ctx, onClose, onAdd }: { ctx: ItemCtx; onClose: () => void; onAdd: (row: MenuRow) => unknown }) {
    const [r, setR] = useState<MenuRow>(newRow(ctx.isSlot, ctx.fulfilment, ctx.units[0] || 'flat'));
    const [idx, setIdx] = useState(0);
    const [busy, setBusy] = useState(false);
    const set = (patch: Partial<MenuRow>) => setR((cur) => ({ ...cur, ...patch }));

    type StepKey = 'name' | 'unit' | 'photo' | 'price' | 'group' | 'hours' | 'duration' | 'capacity' | 'party' | 'describe' | 'review';
    // Name, then how it's charged (only when there's a choice), then the price —
    // asked per that unit — then duration, capacity, description and photo.
    const steps: StepKey[] = ['name'];
    if (!ctx.timed && ctx.units.length > 1) steps.push('unit');
    steps.push('price');
    if (offersGroupPrice(ctx, r.unit)) steps.push('group');
    if (r.unit === 'hour') steps.push('hours');
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

    const titles: Record<StepKey, string> = { ...STEP_QUESTIONS, unit: 'How do you charge for it?', price: priceQuestion(r.unit, ctx.timed), group: 'A price for the whole group?', hours: STEP_QUESTIONS.hours, review: 'Review your offering' };

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

            {key === 'unit' && (
                <div className="mx-auto w-full max-w-md"><UnitTiles ctx={ctx} unit={r.unit} onUnit={(u) => set({ unit: u })} /></div>
            )}

            {key === 'price' && (
                <div className="mx-auto w-full max-w-md space-y-8">
                    <BigAmountInput value={r.price} numeric={false} autoFocus ariaLabel="Price" onChange={(v) => set({ price: cleanAmountInput(v) })} />
                    <KeepLine price={r.price} unit={r.unit} timed={ctx.timed} rate={ctx.commissionRate} />
                </div>
            )}

            {key === 'group' && (
                <div className="mx-auto w-full max-w-md"><GroupPriceField ctx={ctx} value={r.groupPrice} onChange={(v) => set({ groupPrice: v })} /></div>
            )}

            {key === 'hours' && (
                <div className="flex flex-col items-center gap-3">
                    <NumberStepper value={r.minHours} onChange={(v) => set({ minHours: v })} min={1} max={24} suggestion={1} size="lg" solid suffix="hours" />
                    <p className="text-sm text-slate-500">Guests book at least this many. Blank means one hour is fine.</p>
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
                        <div className="mt-1 text-sm text-slate-600">{itemSummary(r, ctx.isSlot, ctx.timed, ctx.shape)}</div>
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

function PriceCard({ ctx, row, perItemLocation, onSave }: { ctx: ItemCtx; row: MenuRow; perItemLocation: boolean; onSave: (r: MenuRow) => unknown }) {
    const c = useCardSheet({ price: row.price, groupPrice: row.groupPrice, unit: row.unit, fulfilment: row.fulfilment }, (d) => onSave({ ...row, ...d }));
    const travelled = perItemLocation && c.draft.fulfilment === 'delivery';
    const priceSummary = row.price
        ? priceWords(row.price, ctx.shape === 'made_to_order' ? 'item' : row.unit, ctx.timed) + (row.unit === 'person' && Number(row.groupPrice) > 0 ? ` · £${row.groupPrice} per group` : '')
        : 'Add a price';
    return (
        <>
            <EditorCard title="Price" summary={priceSummary} onClick={c.start} />
            {c.open && (
                <EditorPanel title={travelled || ctx.timed || ctx.shape === 'made_to_order' || unitChoices(ctx.units, c.draft.unit).length < 2 ? priceQuestion(c.draft.unit, ctx.timed) : 'How do you charge for it?'} onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <div className="space-y-4">
                        {perItemLocation && (
                            <ChoiceTiles value={c.draft.fulfilment === 'delivery' ? 'delivery' : 'collection'}
                                onChange={(v) => c.setDraft(v === 'delivery' ? { ...c.draft, fulfilment: 'delivery', unit: 'flat' } : { ...c.draft, fulfilment: 'collection' })}
                                options={[{ value: 'collection', label: 'At my place' }, { value: 'delivery', label: 'I travel to them' }]} />
                        )}
                        <div className="py-4">
                            <PriceChoice ctx={ctx} price={c.draft.price} unit={c.draft.unit} groupPrice={c.draft.groupPrice} units={!travelled}
                                onPrice={(v) => c.setDraft({ ...c.draft, price: v })} onUnit={(u) => c.setDraft({ ...c.draft, unit: u })}
                                onGroupPrice={(v) => c.setDraft({ ...c.draft, groupPrice: v })} />
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

// A VAT-registered provider's treatment for this offering — it decides whether
// the guest's receipt splits out 20% VAT (standard) or names the supplier and
// VAT number with no split (zero-rated, exempt). Standard unless they change it;
// we never guess it from the category.
function VatTreatmentCard({ row, onSave }: { row: MenuRow; onSave: (r: MenuRow) => unknown }) {
    const c = useCardSheet(row.vatTreatment, (v) => onSave({ ...row, vatTreatment: v }));
    const label = (VAT_TREATMENTS.find((t) => t.value === row.vatTreatment) || VAT_TREATMENTS[0]).label;
    return (
        <>
            <EditorCard title="VAT" summary={label} onClick={c.start} />
            {c.open && (
                <EditorPanel title="How is this offering treated for VAT?" onClose={c.close} footer={<SheetFooter busy={c.busy} onCancel={c.close} onSave={c.save} />}>
                    <ChoiceTiles value={c.draft} onChange={(v) => c.setDraft(v)}
                        options={VAT_TREATMENTS.map((t) => ({ value: t.value, label: t.label }))} />
                    <p className="mt-4 text-sm text-slate-600">Most offerings are standard rate. If you’re unsure, check with your accountant.</p>
                </EditorPanel>
            )}
        </>
    );
}

// Standard/custom, menu section and ingredients kept as cards so nothing that
// affects booking becomes uneditable. (The extra-guest pricing card was removed,
// 9 Oct 2026: a group price covers everyone up to the maximum, and no live
// offering used it.)
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
                        <span className="mt-0.5 block truncate text-sm text-slate-500">{itemSummary(row, ctx.isSlot, ctx.timed, ctx.shape)}</span>
                    </span>
                </button>
            ) : (
                <EditorCard title={row.name.trim() || 'Untitled offering'} summary={itemSummary(row, ctx.isSlot, ctx.timed, ctx.shape)} onClick={() => setOpen(true)} />
            )}
            {open && !selecting && (
                <EditorPanel title={row.name.trim() || 'Offering'} onClose={() => setOpen(false)}>
                    {/* Name, Price, Duration, Capacity, Description, Photo, Available to book. */}
                    <div className="space-y-4">
                        <NameCard row={row} onSave={onSave} />
                        <PriceCard ctx={ctx} row={row} perItemLocation={perItemLocation} onSave={onSave} />
                        {ctx.isSlot && (
                            <StepperCard title="Duration" question={STEP_QUESTIONS.duration} summary={row.duration ? durationLabel(Number(row.duration)) : 'Not set'} value={row.duration} suggestion={60} min={15} step={15} format={durationLabel}
                                onSave={(v) => onSave({ ...row, duration: v })} />
                        )}
                        {ctx.isSlot && perPerson && (
                            <StepperCard title="Capacity" question={STEP_QUESTIONS.capacity} summary={capSummary} value={row.capacity} suggestion={ctx.maxGuests} suffix="people" min={1}
                                onSave={(v) => onSave({ ...row, capacity: v })} />
                        )}
                        {row.unit === 'hour' && (
                            <StepperCard title="Minimum hours" question={STEP_QUESTIONS.hours} summary={row.minHours ? `${row.minHours} hours` : 'One hour is fine'} value={row.minHours} suggestion={1} suffix="hours" min={1}
                                onSave={(v) => onSave({ ...row, minHours: v })} />
                        )}
                        {!ctx.isSlot && perPerson && (
                            <StepperCard title="Smallest party" question={STEP_QUESTIONS.party} summary={partySummary} value={row.minPeople} suggestion={1} suffix="guests" min={1}
                                onSave={(v) => onSave({ ...row, minPeople: v })} />
                        )}
                        <TextDetailCard title="Description" question={STEP_QUESTIONS.describe} placeholder="A line or two a guest reads before booking." value={row.description} empty="Add a description" onSave={(v) => onSave({ ...row, description: v })} />
                        {ctx.shape === 'made_to_order' && <StandardCustomCard row={row} onSave={onSave} />}
                        {ctx.shape === 'made_to_order' && <TextDetailCard title="Menu section" question="Which part of your menu is it in?" placeholder="e.g. Cakes" value={row.category} empty="None" onSave={(v) => onSave({ ...row, category: v })} />}
                        {ctx.shape === 'made_to_order' && <TextDetailCard title="Ingredients" question="What’s in it?" placeholder="e.g. Wheat flour, butter, eggs…" value={row.ingredients} empty="Not added" onSave={(v) => onSave({ ...row, ingredients: v })} />}
                        {ctx.shape === 'made_to_order' && <TextDetailCard title="Allergens" question="Which allergens does it contain?" placeholder="e.g. Contains wheat, egg, milk…" value={row.allergens} empty="Not added" onSave={(v) => onSave({ ...row, allergens: v })} />}
                        <PhotoCard ctx={ctx} row={row} onSave={onSave} />
                        {ctx.vatRegistered && <VatTreatmentCard row={row} onSave={onSave} />}
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
