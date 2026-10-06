'use client';

import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';
import { feeAmount, netOfFee } from '@/lib/fees';

// "Pricing & fees": every amount the host charges, each on a raised card with
// a one-line summary, opening to its fields. Each panel edits a draft; Save
// hands it to the editor, which writes it to the listing (same columns, same
// blanks-mean-none rule).

// No up/down arrows on a money box.
export const NO_SPIN = '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

export function money(value: string | number): string {
    const n = Number(value);
    return '£' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
}

const isSet = (v: string) => v.trim() !== '' && Number(v) > 0;

function MoneyInput({ id, value, onChange, suffix, label }: { id: string; value: string; onChange: (v: string) => void; suffix?: string; label: string }) {
    return (
        <div className="flex items-center border-2 rounded-xl px-3 py-2 max-w-[12rem]">
            <span className="text-slate-500 mr-1">£</span>
            <input id={id} type="number" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0"
                aria-label={label} className={`outline-none w-full text-slate-900 ${NO_SPIN}`} />
            {suffix && <span className="text-slate-500 text-sm ml-1 whitespace-nowrap">{suffix}</span>}
        </div>
    );
}

// A card whose panel edits a copy of `value` until Save.
function PanelCard<T>({ title, summary, value, onSave, children }: {
    title: string;
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
                <EditorPanel title={title} onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(draft))) setOpen(false); }} />}>
                    {children(draft, setDraft)}
                </EditorPanel>
            )}
        </>
    );
}

export function NightlyPriceCard({ price, feePercent, onSave }: { price: string; feePercent: number; onSave: (v: string) => unknown }) {
    return (
        <PanelCard title="Nightly price" summary={isSet(price) ? `${money(price)} / night` : 'Not set'} value={price} onSave={onSave}>
            {(draft, setDraft) => (
                <div>
                    <div className="flex items-center border-2 rounded-2xl px-5 py-4 mb-3">
                        <span className="text-2xl font-black text-slate-900 mr-2">£</span>
                        <input type="number" aria-label="Nightly price" value={draft} onChange={(e) => setDraft(e.target.value)}
                            className={`text-2xl font-black text-slate-900 outline-none w-full ${NO_SPIN}`} />
                        <span className="text-slate-500 ml-2 whitespace-nowrap">/ night</span>
                    </div>
                    {Number(draft) > 0 && (
                        <div className="bg-slate-50 rounded-2xl border p-4 text-sm">
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
        <PanelCard title="Weekend price" summary={isSet(weekendPrice) ? `${money(weekendPrice)} on Fri & Sat nights` : 'Not set'} value={weekendPrice} onSave={onSave}>
            {(draft, setDraft) => (
                <div>
                    <p className="text-sm text-slate-500 mb-3">Charged for Friday and Saturday nights instead of the nightly price. Leave blank for none.</p>
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
        <PanelCard title="Discounts" summary={discountsSummary(discounts)} value={discounts} onSave={onSave}>
            {(draft, setDraft) => (
                <div className="space-y-3">
                    {DISCOUNTS.map((d) => {
                        const on = draft[d.key];
                        return (
                            <button key={d.key} type="button" aria-pressed={on} onClick={() => setDraft({ ...draft, [d.key]: !on })}
                                className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 text-left transition ${on ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                <div className="flex items-center">
                                    <span className="text-sm font-bold text-slate-900 w-12 flex-none">{d.percent}</span>
                                    <div>
                                        <div className="font-semibold text-sm text-slate-900">{d.title}</div>
                                        <div className="text-xs text-slate-500">{d.note}</div>
                                    </div>
                                </div>
                                <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ml-4 ${on ? 'bg-slate-900' : 'border-2 border-slate-300'}`}>
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
        <PanelCard title="Cleaning fee" summary={isSet(fee) ? `${money(fee)} per stay` : 'None'} value={fee} onSave={onSave}>
            {(draft, setDraft) => (
                <div>
                    <p className="text-sm text-slate-500 mb-3">A one-off charge per stay. Always refunded in full if the guest cancels.</p>
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
        <PanelCard title="Extra guest fee" summary={extraGuestSummary(fee, after)} value={{ fee, after }} onSave={(v) => onSave(v.fee, v.after)}>
            {(draft, setDraft) => (
                <div>
                    <p className="text-sm text-slate-500 mb-3">Charged per extra guest, per night, above the number included. Also applies when a booking is changed to add guests.</p>
                    <div className="flex items-end gap-3 flex-wrap">
                        <MoneyInput id="extra-guest-fee" label="Extra guest fee" value={draft.fee} onChange={(v) => setDraft({ ...draft, fee: v })} suffix="/ night" />
                        <div>
                            <label htmlFor="extra-guest-after" className="block text-[12px] text-slate-500 mb-1">Guests included first</label>
                            <input id="extra-guest-after" type="number" inputMode="numeric" min={1} value={draft.after}
                                onChange={(e) => setDraft({ ...draft, after: e.target.value })} placeholder="1"
                                className={`border-2 rounded-xl px-3 py-2 w-20 outline-none text-slate-900 ${NO_SPIN}`} />
                        </div>
                    </div>
                </div>
            )}
        </PanelCard>
    );
}

export function PetFeeCard({ fee, petsAllowed, onSave }: { fee: string; petsAllowed: boolean; onSave: (v: string) => unknown }) {
    return (
        <PanelCard title="Pet fee" summary={isSet(fee) ? `${money(fee)} per stay` : 'None'} value={fee} onSave={onSave}>
            {(draft, setDraft) => (
                <div>
                    <p className="text-sm text-slate-500 mb-3">{petsAllowed ? 'Charged per stay when a guest brings a pet.' : 'Only charged if you allow pets (turn that on in House rules, under Arrival).'}</p>
                    <MoneyInput id="pet-fee" label="Pet fee" value={draft} onChange={setDraft} suffix="/ stay" />
                </div>
            )}
        </PanelCard>
    );
}

export function DamageDepositCard({ deposit, onSave }: { deposit: string; onSave: (v: string) => unknown }) {
    return (
        <PanelCard title="Damage deposit" summary={isSet(deposit) ? money(deposit) : 'None'} value={deposit} onSave={onSave}>
            {(draft, setDraft) => (
                <div>
                    <p className="text-sm text-slate-500 mb-3">Held against damage and released after the stay. Leave blank for none.</p>
                    <MoneyInput id="damage-deposit" label="Damage deposit" value={draft} onChange={setDraft} />
                </div>
            )}
        </PanelCard>
    );
}
