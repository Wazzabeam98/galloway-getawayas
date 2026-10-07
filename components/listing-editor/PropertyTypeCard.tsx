'use client';

import { useState } from 'react';
import PropertyTypeIcon from '@/components/PropertyTypeIcon';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';
import { ChoiceTiles } from '@/components/services/wizardKit';
import { pickerTypes, propertyTypeByName, UNIQUE_STAYS_HEADING, type PropertyType } from '@/lib/propertyTypes';

// Airbnb's "Property type" panel: one dropdown for the type, one for the
// listing type. The tile grid stays in the become-a-host wizard only.

// Stored values (listings.privacy_type) never change; only how they read.
const LISTING_TYPES = [
    { value: 'Entire place', label: 'Entire place', blurb: 'Guests have the whole place to themselves.' },
    { value: 'A private room', label: 'Private room', blurb: 'Guests have their own room in a home, plus access to shared spaces.' },
    { value: 'A shared room', label: 'Shared room', blurb: 'Guests sleep in a room or common area that may be shared with you or others.' },
];

function listingTypeLabel(value: string): string {
    return (LISTING_TYPES.find((t) => t.value === value) || LISTING_TYPES[0]).label;
}

// Each type a large tile with its become-a-host icon — the add flow's
// choice-tile selection style.
function TypeTile({ t, selected, onPick }: { t: PropertyType; selected: boolean; onPick: (name: string) => void }) {
    return (
        <button type="button" role="radio" aria-checked={selected} aria-label={t.label} onClick={() => onPick(t.name)}
            className={'flex flex-col items-start gap-2 rounded-2xl border-2 bg-white p-4 text-left transition hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 '
                + (selected ? 'border-emerald-600 bg-emerald-50/60 shadow-sm' : 'border-slate-200 hover:border-slate-300')}>
            {t.icon ? <PropertyTypeIcon icon={t.icon} className="h-7 w-7 text-slate-800" /> : <span className="h-7" />}
            <span className="text-base font-semibold text-slate-900">{t.label}</span>
        </button>
    );
}

export default function PropertyTypeCard({ propertyType, privacyType, onSave }: {
    propertyType: string;
    privacyType: string;
    onSave: (propertyType: string, privacyType: string) => unknown;
}) {
    const [open, setOpen] = useState(false);
    const [type, setType] = useState(propertyType);
    const [listing, setListing] = useState(privacyType);

    const openPanel = () => { setType(propertyType); setListing(privacyType || 'Entire place'); setOpen(true); };
    const { common, unique } = pickerTypes(propertyType);
    const current = propertyTypeByName(propertyType);
    const summary = [listingTypeLabel(privacyType), current ? current.label : propertyType].filter(Boolean).join(' · ');

    return (
        <>
            <EditorCard title="Property type" summary={summary} onClick={openPanel} />
            {open && (
                <EditorPanel
                    title="What kind of place is it?"
                    onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(type, listing))) setOpen(false); }} disabled={!type} />}
                >
                    <div className="space-y-8">
                        <div role="radiogroup" aria-label="Property type">
                            {type && !propertyTypeByName(type) && (
                                <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                                    <TypeTile t={{ name: type, label: type, icon: '', card: type, noun: 'place', group: 'legacy' }} selected onPick={setType} />
                                </div>
                            )}
                            <h3 className="pb-2 text-base font-semibold text-slate-900">Homes</h3>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {common.map((t) => <TypeTile key={t.name} t={t} selected={type === t.name} onPick={setType} />)}
                            </div>
                            <h3 className="pb-2 pt-6 text-base font-semibold text-slate-900">{UNIQUE_STAYS_HEADING}</h3>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                {unique.map((t) => <TypeTile key={t.name} t={t} selected={type === t.name} onPick={setType} />)}
                            </div>
                        </div>
                        <div>
                            <h3 className="pb-2 text-base font-semibold text-slate-900">Listing type</h3>
                            <ChoiceTiles cols={1} value={listing} onChange={setListing}
                                options={LISTING_TYPES.map((t) => ({ value: t.value, label: t.label, hint: t.blurb }))} />
                        </div>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}
