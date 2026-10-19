'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';
import { ChoiceTiles } from '@/components/services/wizardKit';
import { cancelDaysProblem, customDaysOf, CUSTOM_MIN_DAYS, CUSTOM_MAX_DAYS } from '@/lib/cancellation';
import { customPolicyWords } from '@/lib/bookingDisplay';

// Booking settings, Airbnb's shape: "How guests book" and "Cancellation
// policy" on raised cards, each opening to its existing choices. Each sheet's
// Save writes the listing.

export function HowGuestsBookCard({ instantBook, requiresPhone, onSave }: {
    instantBook: boolean;
    requiresPhone: boolean;
    onSave: (instantBook: boolean, requiresPhone: boolean) => unknown;
}) {
    const [open, setOpen] = useState(false);
    const [instant, setInstant] = useState(instantBook);
    const [phone, setPhone] = useState(requiresPhone);

    return (
        <>
            <EditorCard title="How guests book" summary={instantBook ? 'Instant book' : 'Request to book'}
                onClick={() => { setInstant(instantBook); setPhone(requiresPhone); setOpen(true); }} />
            {open && (
                <EditorPanel title="How do guests book?" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(instant, phone))) setOpen(false); }} />}>
                    <ChoiceTiles cols={1} value={instant ? 'instant' : 'request'} onChange={(v) => setInstant(v === 'instant')}
                        options={[
                            { value: 'request', label: 'Request to book', hint: 'You approve each booking before the guest is charged.' },
                            { value: 'instant', label: 'Instant book', hint: 'Guests book and pay straight away, no approval needed.' },
                        ]} />
                    {instant && (
                        <label className="mt-4 flex items-center justify-between gap-4 rounded-2xl border-2 border-slate-200 p-5">
                            <span>
                                <span className="block text-base font-semibold text-slate-900">Require a phone number</span>
                                <span className="mt-1 block text-sm text-slate-500">Guests add a verified phone before they can instant-book.</span>
                            </span>
                            <button type="button" role="switch" aria-checked={phone} aria-label="Require a phone number" onClick={() => setPhone(!phone)}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${phone ? 'bg-emerald-700' : 'bg-slate-300'}`}>
                                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${phone ? 'translate-x-5' : 'translate-x-0.5'}`} />
                            </button>
                        </label>
                    )}
                </EditorPanel>
            )}
        </>
    );
}

export function CancellationPolicyCard({ policies, policy, customDays, nonRefundable, onSave }: {
    policies: { key: string; bullets: string[] }[];
    policy: string;
    customDays: number;
    nonRefundable: boolean;
    onSave: (policy: string, nonRefundable: boolean, customDays: number) => unknown;
}) {
    const [open, setOpen] = useState(false);
    const [p, setP] = useState(policy);
    const [nr, setNr] = useState(nonRefundable);
    // Held as a string so the host can clear the field while typing without it
    // snapping to a number; validated with the shared rule on save.
    const [days, setDays] = useState(String(customDaysOf(customDays)));

    // Only blocks the save when Custom is the chosen policy — the number is
    // meaningless for the four fixed tiers.
    const daysProblem = p === 'Custom' ? cancelDaysProblem(days) : null;

    // The card summary makes the default visible at a glance: a host on the
    // default sees "Custom · no refund within 30 days" without opening the sheet.
    const summary = policy === 'Custom'
        ? 'Custom · no refund within ' + customDaysOf(customDays) + ' day' + (customDaysOf(customDays) === 1 ? '' : 's') + ' of check-in'
        : policy;

    return (
        <>
            <EditorCard title="Cancellation policy" summary={summary}
                onClick={() => { setP(policy); setNr(nonRefundable); setDays(String(customDaysOf(customDays))); setOpen(true); }} />
            {open && (
                <EditorPanel title="What’s your cancellation policy?" onClose={() => setOpen(false)}
                    footer={<PanelSave disabled={!!daysProblem} onClick={async () => {
                        if (daysProblem) return;
                        const d = p === 'Custom' ? Number(days) : customDaysOf(customDays);
                        if (await saved(onSave(p, nr, d))) setOpen(false);
                    }} />}>
                    {/* Kept: neither rule is guessable. */}
                    <p className="text-base text-slate-600 mb-4">
                        Refunds never include the Galloway Getaways service fee. Cleaning fees are always returned in full.
                    </p>
                    <div className="space-y-3">
                        {policies.map((option) => (
                            <button key={option.key} type="button" onClick={() => setP(option.key)}
                                role="radio" aria-checked={p === option.key}
                                className={`w-full text-left p-5 rounded-2xl border-2 transition ${p === option.key ? 'border-emerald-600 bg-emerald-50/60 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-base font-semibold text-slate-900">{option.key}</span>
                                    {p === option.key && <Check className="w-5 h-5 text-emerald-700" />}
                                </div>
                                {option.key === 'Custom' ? (
                                    <p className="text-sm text-slate-500">
                                        You choose how many days before check-in cancellations stop being refundable.
                                    </p>
                                ) : (
                                    <ul className="text-sm text-slate-500 list-disc pl-4 space-y-0.5">
                                        {option.bullets.map((b) => <li key={b}>{b}</li>)}
                                    </ul>
                                )}
                                {option.key === 'Custom' && p === 'Custom' && (
                                    // The number input lives inside the selected Custom tile. A
                                    // click here must not bubble up and re-fire the tile's
                                    // onClick (which would re-select Custom and steal focus).
                                    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                                        <label className="block text-sm font-medium text-slate-700">
                                            Days before check-in
                                        </label>
                                        <input
                                            type="number"
                                            inputMode="numeric"
                                            min={CUSTOM_MIN_DAYS}
                                            max={CUSTOM_MAX_DAYS}
                                            step={1}
                                            value={days}
                                            onChange={(e) => setDays(e.target.value)}
                                            className={`mt-1 w-28 rounded-xl border-2 px-3 py-2 text-base text-slate-900 ${daysProblem ? 'border-red-400' : 'border-slate-200'}`}
                                        />
                                        <p className={`mt-2 text-sm ${daysProblem ? 'text-red-600' : 'text-slate-600'}`}>
                                            {daysProblem || customPolicyWords(Number(days))}
                                        </p>
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>
                    <div className="mt-4 p-5 border-2 border-slate-200 rounded-2xl flex items-start justify-between gap-4">
                        <div>
                            <div className="font-semibold text-slate-900 text-base mb-1">Non-refundable option</div>
                            <p className="text-sm text-slate-500">
                                For short-term stays, guests pay 10% less in exchange for you keeping your full payout if they cancel.
                            </p>
                        </div>
                        <button type="button" role="switch" aria-checked={nr} aria-label="Non-refundable option" onClick={() => setNr(!nr)}
                            className={`flex-shrink-0 w-11 h-6 rounded-full relative transition ${nr ? 'bg-emerald-700' : 'bg-slate-300'}`}>
                            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${nr ? 'left-5' : 'left-0.5'}`} />
                        </button>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}
