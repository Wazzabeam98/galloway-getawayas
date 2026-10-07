'use client';

import { useState } from 'react';
import AutoTextarea from '@/components/AutoTextarea';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';
import { addressLineLabel } from '@/lib/propertyTypes';
import { listingLocation } from '@/lib/places';
import { ChoiceTiles, bigFieldCls, wizardAreaCls } from '@/components/services/wizardKit';

// The editor's Location section, Airbnb's shape: the address on a raised card
// opening to the address fields, and "Location sharing" opening to the precise-
// location toggle. Each sheet's Save writes the listing.

// "57 St Cuthbert St, Kirkcudbright DG6 4DX"
export function addressSummary(street: string, town: string, postcode: string): string {
    const place = [town.trim(), postcode.trim().toUpperCase()].filter(Boolean).join(' ');
    return [street.trim(), place].filter(Boolean).join(', ');
}

const inputClass = bigFieldCls;
const labelClass = 'block text-base font-semibold text-slate-800';

export function AddressCard({ town, street, postcode, propertyType, onSave }: {
    town: string;
    street: string;
    postcode: string;
    propertyType: string;
    onSave: (town: string, street: string, postcode: string) => unknown;
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
                <EditorPanel title="Where is it?" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(t, s, p))) setOpen(false); }} />}>
                    <div className="space-y-5">
                        {/* Kept: a host can't guess what guests see before booking. */}
                        <p className="text-base text-slate-600">
                            Guests see the town. The street address and postcode stay private until a booking is confirmed.
                        </p>
                        <div>
                            <label htmlFor="edit-town" className={labelClass}>Town / city</label>
                            <input id="edit-town" type="text" value={t} onChange={(e) => setT(e.target.value)} placeholder="e.g. Kirkcudbright" className={inputClass} />
                        </div>
                        <div>
                            <label htmlFor="edit-street" className={labelClass}>{line.label} (private)</label>
                            <input id="edit-street" type="text" value={s} onChange={(e) => setS(e.target.value)} placeholder={line.placeholder} className={inputClass} />
                            {line.hint && <p className="mt-1 text-sm text-slate-600">{line.hint}</p>}
                        </div>
                        <div>
                            <label htmlFor="edit-postcode" className={labelClass}>Postcode (private)</label>
                            <input id="edit-postcode" type="text" value={p} onChange={(e) => setP(e.target.value)} placeholder="e.g. DG6 4JS" className={inputClass} />
                        </div>
                        <p className="text-sm text-slate-600">
                            Guests will see <span className="font-semibold text-slate-900">{listingLocation(t) || 'your town'}</span>.
                        </p>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

export function LocationSharingCard({ precise, onSave }: { precise: boolean; onSave: (precise: boolean) => unknown }) {
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
                <EditorPanel title="Show guests the exact location?" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(on))) setOpen(false); }} />}>
                    <ChoiceTiles cols={1} value={on ? 'precise' : 'approx'} onChange={(v) => setOn(v === 'precise')}
                        options={[
                            { value: 'approx', label: 'Approximate', hint: 'A rough area on the map until they’ve booked.' },
                            { value: 'precise', label: 'Exact pin', hint: 'The exact spot on the map. The address still waits for a booking.' },
                        ]} />
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
    onSave: (nearby: { name: string; time: string }[]) => unknown;
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
                <EditorPanel title="What’s nearby?" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(rows.filter((r) => r.name.trim() || r.time.trim())))) setOpen(false); }} />}>
                    <div className="space-y-3">
                        {rows.map((item, i) => (
                            <div key={i} className="flex gap-2 items-start">
                                <input type="text" value={item.name} placeholder="Kirkcudbright harbour" aria-label="Place"
                                    onChange={(e) => set(i, { name: e.target.value })}
                                    className={'min-w-0 flex-1 ' + inputClass.replace('w-full', '')} />
                                <input type="text" value={item.time} placeholder="3 min walk" aria-label="How far"
                                    onChange={(e) => set(i, { time: e.target.value })}
                                    className={'w-32 sm:w-44 ' + inputClass.replace('w-full', '')} />
                                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove"
                                    className="mt-1 p-3 text-2xl leading-none text-slate-400 hover:text-red-600">
                                    &times;
                                </button>
                            </div>
                        ))}
                    </div>
                    {rows.length < 8 && (
                        <button type="button" onClick={() => setRows(rows.concat([{ name: '', time: '' }]))}
                            className="mt-4 text-base font-semibold text-emerald-700 hover:text-emerald-800">
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
export function NeighbourhoodCard({ text, onSave }: { text: string; onSave: (text: string) => unknown }) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(text);

    return (
        <>
            <EditorCard title="Where you'll be" summary={text.trim() || 'Not added yet'} onClick={() => { setDraft(text); setOpen(true); }} />
            {open && (
                <EditorPanel title="What’s the area like?" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(draft))) setOpen(false); }} />}>
                    {/* Kept: where it shows, and what it's not for, aren't guessable. */}
                    <p className="text-base text-slate-600 mb-4">Shown under the map. Keep it about the surroundings, not the house.</p>
                    <AutoTextarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={6}
                        maxLength={2000}
                        aria-label="Where you'll be"
                        placeholder="St Cuthbert Street runs through the heart of Kirkcudbright, a two-minute walk from the harbour and the galleries…"
                        className={wizardAreaCls}
                    />
                    <p className="mt-2 text-right text-sm text-slate-500">{draft.length}/2000</p>
                </EditorPanel>
            )}
        </>
    );
}
