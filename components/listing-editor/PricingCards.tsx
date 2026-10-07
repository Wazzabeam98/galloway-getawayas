'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';
import { feeAmount, netOfFee } from '@/lib/fees';
import { amountForBox, cleanAmountInput } from '@/lib/amountInput';
import { BigAmountInput, NumberStepper } from '@/components/services/wizardKit';

// "Pricing & fees": every amount the host charges, each on a raised card with
// a one-line summary, opening to its fields. Each panel edits a draft; Save
// hands it to the editor, which writes it to the listing (same columns, same
// blanks-mean-none rule).


export function money(value: string | number): string {
    const n = Number(value);
    return '£' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
}

const isSet = (v: string) => v.trim() !== '' && Number(v) > 0;

// Every money and number box in the editor. Empty with a light placeholder
// when nothing is set (a stored 0 included), never a leading zero, and tapping
// in selects the whole number so typing replaces it. A text box with a number
// keypad rather than type="number", which can't be selected on every phone.
export function NumberBox({ value, onChange, decimals = true, className, ...rest }: {
    value: string;
    onChange: (v: string) => void;
    decimals?: boolean;
    className?: string;
    id?: string;
    placeholder?: string;
    'aria-label'?: string;
}) {
    // The click that focused the box would otherwise put the caret back.
    const justFocused = useRef(false);
    return (
        <input
            {...rest}
            type="text"
            inputMode={decimals ? 'decimal' : 'numeric'}
            autoComplete="off"
            // A bare 0 shows as the empty box; "0." on the way to "0.50" stays.
            value={value.includes('.') ? cleanAmountInput(value, decimals) : amountForBox(value)}
            onChange={(e) => onChange(cleanAmountInput(e.target.value, decimals))}
            onFocus={(e) => {
                const box = e.currentTarget;
                justFocused.current = true;
                box.select();
                setTimeout(() => box.select(), 0);
            }}
            onMouseUp={(e) => { if (justFocused.current) { e.preventDefault(); justFocused.current = false; } }}
            className={`placeholder:text-slate-300 ${className || ''}`}
        />
    );
}

// The add flow's big £ amount, cleaned exactly as NumberBox cleans it (empty
// for none, no leading zero), with what it's per underneath.
function MoneyInput({ value, onChange, suffix, label }: { id?: string; value: string; onChange: (v: string) => void; suffix?: string; label: string }) {
    return (
        <div className="flex flex-col items-center gap-2">
            <BigAmountInput numeric={false} ariaLabel={label}
                value={value.includes('.') ? cleanAmountInput(value) : amountForBox(value)}
                onChange={(v) => onChange(cleanAmountInput(v))} />
            {suffix && <span className="text-base text-slate-500">{suffix.replace('/ ', 'per ')}</span>}
        </div>
    );
}

// A card whose panel edits a copy of `value` until Save.
function PanelCard<T>({ title, question, summary, value, onSave, children }: {
    title: string;
    // The sheet's heading: the question it asks.
    question: string;
    summary: string;
    value: T;
    onSave: (v: T) => unknown;
    children: (draft: T, setDraft: (v: T) => void) => ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<T>(value);
    return (
        <>
            <EditorCard title={title} summary={summary} onClick={() => { setDraft(value); setOpen(true); }} />
            {open && (
                <EditorPanel title={question} onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(draft))) setOpen(false); }} />}>
                    {children(draft, setDraft)}
                </EditorPanel>
            )}
        </>
    );
}

export function NightlyPriceCard({ price, feePercent, onSave }: { price: string; feePercent: number; onSave: (v: string) => unknown }) {
    return (
        <PanelCard title="Nightly price" question="How much per night?" summary={isSet(price) ? `${money(price)} / night` : 'Not set'} value={price} onSave={onSave}>
            {(draft, setDraft) => (
                <div>
                    <div className="mb-8">
                        <MoneyInput label="Nightly price" value={draft} onChange={setDraft} suffix="/ night" />
                    </div>
                    {Number(draft) > 0 && (
                        <div className="mx-auto max-w-sm bg-slate-50 rounded-2xl border p-4 text-base">
                            <div className="flex justify-between text-slate-600 mb-1">
                                <span>Guest pays</span><span className="font-medium text-slate-900">£{Number(draft).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-slate-600 mb-1">
                                <span>Host fee ({feePercent}%)</span>
                                <span className="font-medium text-slate-900">− £{feeAmount(Number(draft), feePercent).toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between pt-1 border-t border-slate-200">
                                <span className="font-semibold text-slate-900">You receive</span>
                                <span className="font-bold text-emerald-700">£{netOfFee(Number(draft), feePercent).toFixed(2)}</span>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </PanelCard>
    );
}

export function WeekendPriceCard({ weekendPrice, onSave }: { weekendPrice: string; onSave: (v: string) => unknown }) {
    return (
        <PanelCard title="Weekend price" question="How much on Friday and Saturday nights?" summary={isSet(weekendPrice) ? `${money(weekendPrice)} on Fri & Sat nights` : 'Not set'} value={weekendPrice} onSave={onSave}>
            {(draft, setDraft) => (
                <div>
                    <p className="mb-6 text-center text-base text-slate-600">Instead of the nightly price. Leave blank for none.</p>
                    <MoneyInput id="weekend-price" label="Weekend price" value={draft} onChange={setDraft} suffix="/ night" />
                </div>
            )}
        </PanelCard>
    );
}

export type Discounts = { newListingPromo: boolean; lastMinute: boolean; weekly: boolean; monthly: boolean };

const DISCOUNTS: { key: keyof Discounts; percent: string; title: string; short: string; note: string }[] = [
    { key: 'newListingPromo', percent: '20%', title: 'New listing promotion', short: 'New listing', note: 'Applies automatically to your first 3 bookings' },
    { key: 'lastMinute', percent: '5%', title: 'Last-minute discount', short: 'Last-minute', note: 'For stays booked 14 days or less before arrival' },
    { key: 'weekly', percent: '10%', title: 'Weekly discount', short: 'Weekly', note: 'For stays of 7 nights or more' },
    { key: 'monthly', percent: '20%', title: 'Monthly discount', short: 'Monthly', note: 'For stays of 28 nights or more' },
];

export function discountsSummary(d: Discounts): string {
    const on = DISCOUNTS.filter((x) => d[x.key]).map((x) => `${x.short} ${x.percent}`);
    return on.length ? on.join(' · ') : 'None';
}

export function DiscountsCard({ discounts, onSave }: { discounts: Discounts; onSave: (d: Discounts) => unknown }) {
    return (
        <PanelCard title="Discounts" question="Which discounts do you offer?" summary={discountsSummary(discounts)} value={discounts} onSave={onSave}>
            {(draft, setDraft) => (
                <div className="space-y-3">
                    {DISCOUNTS.map((d) => {
                        const on = draft[d.key];
                        return (
                            <button key={d.key} type="button" aria-pressed={on} onClick={() => setDraft({ ...draft, [d.key]: !on })}
                                className={`w-full flex items-center justify-between p-5 rounded-2xl border-2 text-left transition ${on ? 'border-emerald-600 bg-emerald-50/60 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}>
                                <div className="flex items-center">
                                    <span className="text-lg font-extrabold text-slate-900 w-14 flex-none">{d.percent}</span>
                                    <div>
                                        <div className="font-semibold text-base text-slate-900">{d.title}</div>
                                        <div className="mt-0.5 text-sm text-slate-500">{d.note}</div>
                                    </div>
                                </div>
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ml-4 ${on ? 'bg-emerald-700' : 'border-2 border-slate-300 bg-white'}`}>
                                    {on && <Check className="w-4 h-4 text-white" />}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </PanelCard>
    );
}

export function CleaningFeeCard({ fee, onSave }: { fee: string; onSave: (v: string) => unknown }) {
    return (
        <PanelCard title="Cleaning fee" question="How much is the cleaning fee?" summary={isSet(fee) ? `${money(fee)} per stay` : 'None'} value={fee} onSave={onSave}>
            {(draft, setDraft) => (
                <div>
                    <p className="mb-6 text-center text-base text-slate-600">Always refunded in full if the guest cancels.</p>
                    <MoneyInput id="cleaning-fee" label="Cleaning fee" value={draft} onChange={setDraft} suffix="/ stay" />
                </div>
            )}
        </PanelCard>
    );
}

export function extraGuestSummary(fee: string, after: string): string {
    if (!isSet(fee)) return 'None';
    const n = Number(after) || 1;
    return `${money(fee)} per guest per night after ${n} guest${n === 1 ? '' : 's'}`;
}

export function ExtraGuestFeeCard({ fee, after, onSave }: { fee: string; after: string; onSave: (fee: string, after: string) => unknown }) {
    return (
        <PanelCard title="Extra guest fee" question="Do extra guests pay more?" summary={extraGuestSummary(fee, after)} value={{ fee, after }} onSave={(v) => onSave(v.fee, v.after)}>
            {(draft, setDraft) => (
                <div>
                    <p className="mb-6 text-center text-base text-slate-600">Per extra guest, per night, above the number included — also when a booking is changed to add guests.</p>
                    <div className="space-y-8">
                        <MoneyInput id="extra-guest-fee" label="Extra guest fee" value={draft.fee} onChange={(v) => setDraft({ ...draft, fee: v })} suffix="/ night" />
                        <div className="flex flex-col items-center gap-2" role="group" aria-label="Guests included first">
                            <span className="text-base font-semibold text-slate-800">Guests included first</span>
                            <NumberStepper value={draft.after} onChange={(v) => setDraft({ ...draft, after: cleanAmountInput(v, false) })} min={1} max={50} suggestion={1} />
                        </div>
                    </div>
                </div>
            )}
        </PanelCard>
    );
}

export function PetFeeCard({ fee, petsAllowed, onSave }: { fee: string; petsAllowed: boolean; onSave: (v: string) => unknown }) {
    return (
        <PanelCard title="Pet fee" question="How much is the pet fee?" summary={isSet(fee) ? `${money(fee)} per stay` : 'None'} value={fee} onSave={onSave}>
            {(draft, setDraft) => (
                <div>
                    {!petsAllowed && <p className="mb-6 text-center text-base text-slate-600">Only charged if you allow pets (turn that on in House rules, under Arrival).</p>}
                    <MoneyInput id="pet-fee" label="Pet fee" value={draft} onChange={setDraft} suffix="/ stay" />
                </div>
            )}
        </PanelCard>
    );
}

export function DamageDepositCard({ deposit, onSave }: { deposit: string; onSave: (v: string) => unknown }) {
    return (
        <PanelCard title="Damage deposit" question="How much is the damage deposit?" summary={isSet(deposit) ? money(deposit) : 'None'} value={deposit} onSave={onSave}>
            {(draft, setDraft) => (
                <div>
                    <MoneyInput id="damage-deposit" label="Damage deposit" value={draft} onChange={setDraft} />
                </div>
            )}
        </PanelCard>
    );
}
