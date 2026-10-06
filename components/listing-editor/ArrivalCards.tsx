'use client';

import { useState, type ReactNode } from 'react';
import { Check, X, Minus, Plus, ArrowLeft } from 'lucide-react';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';
import AutoTextarea from '@/components/AutoTextarea';
import {
    CHECKOUT_TASKS, CHECKOUT_NOTE_MAX, MAX_PETS_CAP, DEFAULT_MAX_PETS, checkoutTaskLabels,
    SAFETY_GROUPS, SAFETY_DETAILS_MAX, sharedSpacesForced, guestSafetyProblem,
    type GuestSafety, type SafetyAnswer, type SafetyGroup,
} from '@/lib/listingSafety';

// The editor's Arrival cards for House rules, Checkout instructions and Guest
// safety. Each edits a draft and hands it back on Save; the listing's main
// Save stores it (/api/listings/save, which cleans it with lib/listingSafety).

// ✗ / ✓ pair, as the house rules have always used.
export function YesNo({ value, onChange, label }: { value: boolean | null; onChange: (v: boolean) => void; label: string }) {
    const btn = (on: boolean) =>
        `w-8 h-8 rounded-full flex items-center justify-center ${on ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`;
    return (
        <div className="flex gap-2 flex-none">
            <button type="button" aria-label={label + ': no'} aria-pressed={value === false} onClick={() => onChange(false)} className={btn(value === false)}>
                <X className="w-4 h-4" />
            </button>
            <button type="button" aria-label={label + ': yes'} aria-pressed={value === true} onClick={() => onChange(true)} className={btn(value === true)}>
                <Check className="w-4 h-4" />
            </button>
        </div>
    );
}

function hm(v: string) { return (v || '').slice(0, 5); }

// ---------------------------------------------------------------------------
// House rules
// ---------------------------------------------------------------------------

export type HouseRules = {
    petsAllowed: boolean;
    maxPets: number;
    eventsAllowed: boolean;
    smokingAllowed: boolean;
    commercialPhotographyAllowed: boolean;
    quietHoursEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
    additionalRules: string;
};

export function houseRulesSummary(r: HouseRules): string {
    return [
        r.petsAllowed ? `Pets allowed (up to ${r.maxPets})` : 'No pets',
        r.eventsAllowed ? 'Events allowed' : 'No events',
        r.smokingAllowed ? 'Smoking allowed' : 'No smoking',
        r.quietHoursEnabled ? `Quiet hours ${hm(r.quietHoursStart)}–${hm(r.quietHoursEnd)}` : null,
    ].filter(Boolean).join(' · ');
}

export function HouseRulesCard({ rules, onSave }: { rules: HouseRules; onSave: (r: HouseRules) => unknown }) {
    const [open, setOpen] = useState(false);
    const [d, setD] = useState(rules);
    const set = (patch: Partial<HouseRules>) => setD({ ...d, ...patch });

    const rows: { label: string; key: 'eventsAllowed' | 'smokingAllowed' | 'commercialPhotographyAllowed' }[] = [
        { label: 'Events allowed', key: 'eventsAllowed' },
        { label: 'Smoking, vaping, e-cigarettes allowed', key: 'smokingAllowed' },
        { label: 'Commercial photography and filming allowed', key: 'commercialPhotographyAllowed' },
    ];

    return (
        <>
            <EditorCard title="House rules" summary={houseRulesSummary(rules)} onClick={() => { setD(rules); setOpen(true); }} />
            {open && (
                <EditorPanel title="House rules" onClose={() => setOpen(false)} footer={<PanelSave onClick={async () => { if (await saved(onSave(d))) setOpen(false); }} />}>
                    <p className="text-sm text-slate-500 mb-4">Guests are expected to follow your rules and may be removed if they don&apos;t.</p>
                    <div className="border rounded-2xl divide-y">
                        <div className="p-4">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-medium text-slate-800">Pets allowed</span>
                                <YesNo label="Pets allowed" value={d.petsAllowed} onChange={(v) => set({ petsAllowed: v, maxPets: v && !d.petsAllowed ? DEFAULT_MAX_PETS : d.maxPets })} />
                            </div>
                            {d.petsAllowed && (
                                <div className="mt-3 flex items-center justify-between">
                                    <span className="text-sm text-slate-700">Maximum number of pets</span>
                                    <div className="flex items-center space-x-4">
                                        <button type="button" aria-label="Fewer pets" disabled={d.maxPets <= 1} onClick={() => set({ maxPets: d.maxPets - 1 })}
                                            className="w-8 h-8 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900 disabled:opacity-30"><Minus className="w-4 h-4" /></button>
                                        <span className="w-6 text-center" aria-live="polite">{d.maxPets}</span>
                                        <button type="button" aria-label="More pets" disabled={d.maxPets >= MAX_PETS_CAP} onClick={() => set({ maxPets: d.maxPets + 1 })}
                                            className="w-8 h-8 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900 disabled:opacity-30"><Plus className="w-4 h-4" /></button>
                                    </div>
                                </div>
                            )}
                        </div>
                        {rows.map((r) => (
                            <div key={r.key} className="p-4 flex items-center justify-between gap-3">
                                <span className="text-sm font-medium text-slate-800">{r.label}</span>
                                <YesNo label={r.label} value={d[r.key]} onChange={(v) => set({ [r.key]: v } as Partial<HouseRules>)} />
                            </div>
                        ))}
                        <div className="p-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <span className="text-sm font-medium text-slate-800">Quiet hours</span>
                                <YesNo label="Quiet hours" value={d.quietHoursEnabled} onChange={(v) => set({ quietHoursEnabled: v })} />
                            </div>
                            {d.quietHoursEnabled && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="qh-start" className="text-xs text-slate-500">Start time</label>
                                        <input id="qh-start" type="time" value={d.quietHoursStart} onChange={(e) => set({ quietHoursStart: e.target.value })} className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                    </div>
                                    <div>
                                        <label htmlFor="qh-end" className="text-xs text-slate-500">End time</label>
                                        <input id="qh-end" type="time" value={d.quietHoursEnd} onChange={(e) => set({ quietHoursEnd: e.target.value })} className="w-full p-2.5 border rounded-lg text-sm mt-1" />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    <h3 className="font-semibold text-slate-800 mt-6 mb-2">Additional rules</h3>
                    <AutoTextarea value={d.additionalRules} onChange={(e) => set({ additionalRules: e.target.value })} rows={4}
                        aria-label="Additional rules" placeholder="Share anything else you expect from guests..." className="w-full p-3 border rounded-xl text-sm" />
                </EditorPanel>
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Checkout instructions
// ---------------------------------------------------------------------------

export function CheckoutInstructionsCard({ tasks, note, onSave }: { tasks: string[]; note: string; onSave: (tasks: string[], note: string) => unknown }) {
    const [open, setOpen] = useState(false);
    const [t, setT] = useState<string[]>(tasks);
    const [n, setN] = useState(note);
    const labels = checkoutTaskLabels(tasks);
    const summary = labels.length ? labels.join(' · ') : note.trim() ? note.trim() : 'Not added yet';

    return (
        <>
            <EditorCard title="Checkout instructions" summary={summary} onClick={() => { setT(tasks); setN(note); setOpen(true); }} />
            {open && (
                <EditorPanel title="Checkout instructions" onClose={() => setOpen(false)} footer={<PanelSave onClick={async () => { if (await saved(onSave(t, n))) setOpen(false); }} />}>
                    <div className="divide-y border-y">
                        {CHECKOUT_TASKS.map((task) => {
                            const on = t.indexOf(task.key) !== -1;
                            return (
                                <button key={task.key} type="button" role="checkbox" aria-checked={on}
                                    onClick={() => setT(on ? t.filter((k) => k !== task.key) : [...t, task.key])}
                                    className="flex w-full items-center justify-between gap-3 py-3.5 text-left">
                                    <span className="text-sm text-slate-800">{task.label}</span>
                                    <span className={`h-6 w-6 flex-none rounded-md flex items-center justify-center ${on ? 'bg-slate-900' : 'border-2 border-slate-300'}`}>
                                        {on && <Check className="h-4 w-4 text-white" />}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    <label htmlFor="checkout-note" className="mt-5 block text-sm font-semibold text-slate-900 mb-1">Anything else</label>
                    <AutoTextarea id="checkout-note" value={n} onChange={(e) => setN(e.target.value)} rows={3} maxLength={CHECKOUT_NOTE_MAX}
                        placeholder="Leave the keys on the kitchen table." className="w-full p-3 border rounded-xl text-sm" />
                </EditorPanel>
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Guest safety — a card opening to three cards, each a list of ✗ / ✓ items.
// ---------------------------------------------------------------------------

export function GuestSafetyCard({ safety, privacyType, alarmAnswers, onSave }: {
    safety: GuestSafety;
    privacyType: string;
    // The alarms' current answers, from the amenities (where they're stored).
    alarmAnswers: Record<string, SafetyAnswer | null>;
    onSave: (s: GuestSafety) => unknown;
}) {
    const [open, setOpen] = useState(false);
    const [group, setGroup] = useState<SafetyGroup | null>(null);
    const [d, setD] = useState<GuestSafety>({});
    const [error, setError] = useState('');

    const current = (s: GuestSafety, key: string): SafetyAnswer | null => {
        if (key === 'shared_spaces' && sharedSpacesForced(privacyType)) return { yes: true, details: s.shared_spaces?.details };
        return s[key] ?? alarmAnswers[key] ?? null;
    };
    const seed = (): GuestSafety => {
        const out: GuestSafety = { ...safety };
        for (const [k, v] of Object.entries(alarmAnswers)) if (v && !out[k]) out[k] = v;
        return out;
    };
    const ticked = (s: GuestSafety, g: SafetyGroup) => g.items.filter((i) => current(s, i.key)?.yes).map((i) => i.label);
    const groupSummary = (s: GuestSafety, g: SafetyGroup) => {
        const on = ticked(s, g);
        return on.length ? on.join(' · ') : g.items.some((i) => current(s, i.key)) ? 'None' : 'Not added yet';
    };
    const allTicked = SAFETY_GROUPS.flatMap((g) => ticked(seed(), g));

    const setItem = (key: string, patch: Partial<SafetyAnswer>) => {
        const prev = current(d, key) || { yes: false };
        setD({ ...d, [key]: { ...prev, ...patch } as SafetyAnswer });
        setError('');
    };

    const save = async () => {
        const problem = guestSafetyProblem(d);
        if (problem) { setError(problem); return; }
        if (!(await saved(onSave(d)))) return;
        setOpen(false);
        setGroup(null);
    };

    const back = (
        <button type="button" onClick={() => setGroup(null)} aria-label="Back" className="rounded-full p-1.5 text-slate-600 hover:bg-slate-100">
            <ArrowLeft className="h-5 w-5" />
        </button>
    );

    let body: ReactNode;
    if (!group) {
        body = (
            <div className="space-y-4">
                {SAFETY_GROUPS.map((g) => (
                    <EditorCard key={g.key} title={g.title} summary={groupSummary(d, g)} onClick={() => setGroup(g)} />
                ))}
            </div>
        );
    } else {
        body = (
            <div className="divide-y border-y">
                {group.items.map((item) => {
                    const a = current(d, item.key);
                    const locked = item.key === 'shared_spaces' && sharedSpacesForced(privacyType);
                    return (
                        <div key={item.key} className="py-4">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-medium text-slate-800">{item.label}</span>
                                {locked
                                    ? <span className="text-xs text-slate-500">Yes — it&apos;s a room</span>
                                    : <YesNo label={item.label} value={a ? a.yes : null} onChange={(v) => setItem(item.key, { yes: v })} />}
                            </div>
                            {a?.yes && (
                                <div className="mt-2">
                                    <AutoTextarea aria-label={item.label + ' details'} value={a.details || ''} rows={2} maxLength={SAFETY_DETAILS_MAX}
                                        onChange={(e) => setItem(item.key, { details: e.target.value })}
                                        placeholder={item.detailsRequired ? 'Where is it? (required)' : 'Add details (optional)'}
                                        className="w-full p-2.5 border rounded-xl text-sm" />
                                </div>
                            )}
                        </div>
                    );
                })}
                {error && <p role="alert" className="pt-3 text-sm text-rose-700">{error}</p>}
            </div>
        );
    }

    return (
        <>
            <EditorCard title="Guest safety" summary={allTicked.length ? allTicked.join(' · ') : 'Not added yet'}
                onClick={() => { setD(seed()); setGroup(null); setError(''); setOpen(true); }} />
            {open && (
                <EditorPanel title={group ? group.title : 'Guest safety'} onClose={() => { setOpen(false); setGroup(null); }}
                    leading={group ? back : undefined}
                    footer={<PanelSave onClick={save} />}>
                    {body}
                </EditorPanel>
            )}
        </>
    );
}

