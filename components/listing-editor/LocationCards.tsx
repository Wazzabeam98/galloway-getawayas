'use client';

import { useState } from 'react';
import { EditorCard, EditorPanel, PanelSave } from '@/components/listing-editor/EditorPanel';
import { addressLineLabel } from '@/lib/propertyTypes';
import { buildLocation } from '@/lib/places';

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

export function AddressCard({ town, region, street, postcode, propertyType, onSave }: {
    town: string;
    region: string;
    street: string;
    postcode: string;
    propertyType: string;
    onSave: (town: string, region: string, street: string, postcode: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [t, setT] = useState(town);
    const [r, setR] = useState(region);
    const [s, setS] = useState(street);
    const [p, setP] = useState(postcode);
    const line = addressLineLabel(propertyType);

    const openPanel = () => { setT(town); setR(region); setS(street); setP(postcode); setOpen(true); };

    return (
        <>
            <EditorCard title="Address" summary={addressSummary(street, town, postcode) || 'Add the address'} onClick={openPanel} />
            {open && (
                <EditorPanel title="Address" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={() => { onSave(t, r, s, p); setOpen(false); }} />}>
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
                            <label htmlFor="edit-region" className={labelClass}>Region</label>
                            <input id="edit-region" type="text" value={r} onChange={(e) => setR(e.target.value)} placeholder="e.g. Dumfries and Galloway" className={inputClass} />
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
                            Guests will see <span className="font-medium text-slate-700">{buildLocation(t, r) || 'your town and region'}</span>.
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
