'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';

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
                <EditorPanel title="How guests book" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(instant, phone))) setOpen(false); }} />}>
                    <div className="grid grid-cols-1 gap-3">
                        <button type="button" aria-pressed={!instant} onClick={() => setInstant(false)}
                            className={`text-left px-4 py-3.5 rounded-xl border transition ${!instant ? 'border-slate-900 border-2' : 'border-slate-200 hover:border-slate-400'}`}>
                            <div className={`text-sm ${!instant ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>Request to book</div>
                            <div className="text-xs text-slate-500 mt-0.5">You approve each booking before the guest is charged.</div>
                        </button>
                        <button type="button" aria-pressed={instant} onClick={() => setInstant(true)}
                            className={`text-left px-4 py-3.5 rounded-xl border transition ${instant ? 'border-slate-900 border-2' : 'border-slate-200 hover:border-slate-400'}`}>
                            <div className={`text-sm ${instant ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>Instant book</div>
                            <div className="text-xs text-slate-500 mt-0.5">Guests book and pay straight away, no approval needed.</div>
                        </button>
                    </div>
                    {instant && (
                        <label className="mt-3 flex items-center justify-between gap-4 rounded-xl border p-4">
                            <span>
                                <span className="block text-sm font-medium text-slate-800">Require a phone number</span>
                                <span className="block text-xs text-slate-500">Guests add a verified phone before they can instant-book.</span>
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
                <EditorPanel title="Cancellation policy" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(p, nr))) setOpen(false); }} />}>
                    <p className="text-xs text-slate-500 mb-3">
                        All refunds exclude the Galloway Getaways service fee. Cleaning fees are always returned in full, since the clean doesn&apos;t happen.
                    </p>
                    <div className="space-y-3">
                        {policies.map((option) => (
                            <button key={option.key} type="button" aria-pressed={p === option.key} onClick={() => setP(option.key)}
                                className={`w-full text-left p-4 rounded-2xl border-2 transition ${p === option.key ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="font-semibold text-slate-900">{option.key}</span>
                                    {p === option.key && <Check className="w-4 h-4 text-slate-900" />}
                                </div>
                                <ul className="text-xs text-slate-500 list-disc pl-4 space-y-0.5">
                                    {option.bullets.map((b) => <li key={b}>{b}</li>)}
                                </ul>
                            </button>
                        ))}
                    </div>
                    <div className="mt-4 p-4 border rounded-2xl flex items-start justify-between gap-4">
                        <div>
                            <div className="font-semibold text-slate-900 text-sm mb-1">Non-refundable option</div>
                            <p className="text-xs text-slate-500">
                                For short-term stays, guests pay 10% less in exchange for you keeping your full payout if they cancel.
                            </p>
                        </div>
                        <button type="button" role="switch" aria-checked={nr} aria-label="Non-refundable option" onClick={() => setNr(!nr)}
                            className={`flex-shrink-0 w-11 h-6 rounded-full relative transition ${nr ? 'bg-slate-900' : 'bg-slate-300'}`}>
                            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${nr ? 'left-5' : 'left-0.5'}`} />
                        </button>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}
