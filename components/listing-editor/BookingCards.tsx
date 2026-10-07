'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';
import { ChoiceTiles } from '@/components/services/wizardKit';

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

export function CancellationPolicyCard({ policies, policy, nonRefundable, onSave }: {
    policies: { key: string; bullets: string[] }[];
    policy: string;
    nonRefundable: boolean;
    onSave: (policy: string, nonRefundable: boolean) => unknown;
}) {
    const [open, setOpen] = useState(false);
    const [p, setP] = useState(policy);
    const [nr, setNr] = useState(nonRefundable);

    return (
        <>
            <EditorCard title="Cancellation policy" summary={policy}
                onClick={() => { setP(policy); setNr(nonRefundable); setOpen(true); }} />
            {open && (
                <EditorPanel title="What’s your cancellation policy?" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(p, nr))) setOpen(false); }} />}>
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
                                <ul className="text-sm text-slate-500 list-disc pl-4 space-y-0.5">
                                    {option.bullets.map((b) => <li key={b}>{b}</li>)}
                                </ul>
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
