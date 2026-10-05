'use client';

import { useState } from 'react';
import { EditorCard, EditorPanel, PanelSave } from '@/components/listing-editor/EditorPanel';
import { addressLineLabel } from '@/lib/propertyTypes';
import { listingLocation } from '@/lib/places';

// The editor's Location section, Airbnb's shape: the address on a raised card
// opening to the address fields, and "Location sharing" opening to the precise-
// location toggle. Both save with the listing's main Save.

// "57 St Cuthbert St, Kirkcudbright DG6 4DX"
export function addressSummary(street: string, town: string, postcode: string): string {
    const place = [town.trim(), postcode.trim().toUpperCase()].filter(Boolean).join(' ');
    return [street.trim(), place].filter(Boolean).join(', ');
}

const inputClass = 'w-full p-3 border rounded-xl text-sm mt-1';
const labelClass = 'text-xs text-slate-500 font-semibold uppercase';

export function AddressCard({ town, street, postcode, propertyType, onSave }: {
    town: string;
    street: string;
    postcode: string;
    propertyType: string;
    onSave: (town: string, street: string, postcode: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [t, setT] = useState(town);
    const [s, setS] = useState(street);
    const [p, setP] = useState(postcode);
    const line = addressLineLabel(propertyType);

    const openPanel = () => { setT(town); setS(street); setP(postcode); setOpen(true); };

    return (
        <>
            <EditorCard title="Address" summary={addressSummary(street, town, postcode) || 'Add the address'} onClick={openPanel} />
            {open && (
                <EditorPanel title="Address" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={() => { onSave(t, s, p); setOpen(false); }} />}>
                    <div className="space-y-4">
                        <p className="text-sm text-slate-500">
                            Guests see the town and region. The street address and postcode are kept
                            private until a booking is confirmed.
                        </p>
                        <div>
                            <label htmlFor="edit-town" className={labelClass}>Town / city</label>
                            <input id="edit-town" type="text" value={t} onChange={(e) => setT(e.target.value)} placeholder="e.g. Kirkcudbright" className={inputClass} />
                        </div>
                        <div>
                            <label htmlFor="edit-street" className={labelClass}>{line.label} (private)</label>
                            <input id="edit-street" type="text" value={s} onChange={(e) => setS(e.target.value)} placeholder={line.placeholder} className={inputClass} />
                            {line.hint && <p className="mt-1 text-xs text-slate-500">{line.hint}</p>}
                        </div>
                        <div>
                            <label htmlFor="edit-postcode" className={labelClass}>Postcode (private)</label>
                            <input id="edit-postcode" type="text" value={p} onChange={(e) => setP(e.target.value)} placeholder="e.g. DG6 4JS" className={inputClass} />
                        </div>
                        <p className="text-xs text-slate-500">
                            Guests will see <span className="font-medium text-slate-700">{listingLocation(t) || 'your town'}</span>.
                        </p>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

export function LocationSharingCard({ precise, onSave }: { precise: boolean; onSave: (precise: boolean) => void }) {
    const [open, setOpen] = useState(false);
    const [on, setOn] = useState(precise);

    return (
        <>
            <EditorCard
                title="Location sharing"
                summary={precise ? 'Precise location shown' : 'Approximate location shown'}
                onClick={() => { setOn(precise); setOpen(true); }}
            />
            {open && (
                <EditorPanel title="Location sharing" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={() => { onSave(on); setOpen(false); }} />}>
                    <label className="flex items-start justify-between gap-4 cursor-pointer">
                        <span>
                            <span className="block text-sm font-semibold text-slate-900">Show the precise location</span>
                            <span className="mt-0.5 block text-sm text-slate-500">
                                Make it clear to guests where your place is. We&apos;ll only share your address after they&apos;ve booked.
                            </span>
                        </span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={on}
                            aria-label="Show the precise location"
                            onClick={() => setOn(!on)}
                            className={`relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${on ? 'bg-emerald-700' : 'bg-slate-300'}`}
                        >
                            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </button>
                    </label>
                </EditorPanel>
            )}
        </>
    );
}

// "What's nearby": the places on one line, opening to the place / time rows.
export function nearbySummary(nearby: { name: string; time: string }[]): string {
    const names = nearby.map((n) => n.name.trim()).filter(Boolean);
    return names.length ? names.join(' · ') : 'Not added yet';
}

export function NearbyCard({ nearby, onSave }: {
    nearby: { name: string; time: string }[];
    onSave: (nearby: { name: string; time: string }[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState(nearby);

    const set = (i: number, patch: Partial<{ name: string; time: string }>) => {
        const next = rows.slice();
        next[i] = { ...next[i], ...patch };
        setRows(next);
    };

    return (
        <>
            <EditorCard title="What's nearby" summary={nearbySummary(nearby)} onClick={() => { setRows(nearby.length ? nearby : [{ name: '', time: '' }]); setOpen(true); }} />
            {open && (
                <EditorPanel title="What's nearby" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={() => { onSave(rows.filter((r) => r.name.trim() || r.time.trim())); setOpen(false); }} />}>
                    <p className="text-sm text-slate-500 mb-4">
                        The places you&apos;d tell a friend about — the harbour, the good bakery, the
                        beach. Guests care about this far more than a map can show them.
                    </p>
                    <div className="space-y-3">
                        {rows.map((item, i) => (
                            <div key={i} className="flex gap-2 items-start">
                                <input type="text" value={item.name} placeholder="Kirkcudbright harbour" aria-label="Place"
                                    onChange={(e) => set(i, { name: e.target.value })}
                                    className="min-w-0 flex-1 p-3 border rounded-xl text-sm" />
                                <input type="text" value={item.time} placeholder="3 min walk" aria-label="How far"
                                    onChange={(e) => set(i, { time: e.target.value })}
                                    className="w-28 sm:w-40 p-3 border rounded-xl text-sm" />
                                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove"
                                    className="p-3 text-slate-400 hover:text-red-600">
                                    &times;
                                </button>
                            </div>
                        ))}
                    </div>
                    {rows.length < 8 && (
                        <button type="button" onClick={() => setRows(rows.concat([{ name: '', time: '' }]))}
                            className="mt-3 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
                            + Add a place
                        </button>
                    )}
                </EditorPanel>
            )}
        </>
    );
}

// "Where you'll be" — Airbnb's "Neighbourhood description": the start of the
// text on the card, the field behind it.
export function NeighbourhoodCard({ text, onSave }: { text: string; onSave: (text: string) => void }) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(text);

    return (
        <>
            <EditorCard title="Where you'll be" summary={text.trim() || 'Not added yet'} onClick={() => { setDraft(text); setOpen(true); }} />
            {open && (
                <EditorPanel title="Where you'll be" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={() => { onSave(draft); setOpen(false); }} />}>
                    <p className="text-sm text-slate-500 mb-4">
                        A few lines about the area — the street, the walk into town, what&apos;s on
                        the doorstep. Shown under the map. Keep it about the surroundings, not the
                        house itself (the description covers that).
                    </p>
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={6}
                        maxLength={2000}
                        aria-label="Where you'll be"
                        placeholder="St Cuthbert Street runs through the heart of Kirkcudbright, a two-minute walk from the harbour and the galleries…"
                        className="w-full p-3 border rounded-xl text-sm"
                    />
                    <p className="mt-1 text-xs text-slate-400">{draft.length}/2000</p>
                </EditorPanel>
            )}
        </>
    );
}
