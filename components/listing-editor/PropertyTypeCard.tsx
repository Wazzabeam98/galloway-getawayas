'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { EditorCard, EditorPanel, PanelSave } from '@/components/listing-editor/EditorPanel';
import { pickerTypes, propertyTypeByName, UNIQUE_STAYS_HEADING } from '@/lib/propertyTypes';

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

const selectClass = 'w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 pb-2.5 pt-6 text-sm text-slate-900 focus:border-slate-900 focus:outline-none';

function Select({ id, label, value, onChange, children }: {
    id: string; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
    return (
        <div className="relative">
            <label htmlFor={id} className="pointer-events-none absolute left-3 top-2 text-xs text-slate-500">{label}</label>
            <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
                {children}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        </div>
    );
}

export default function PropertyTypeCard({ propertyType, privacyType, onSave }: {
    propertyType: string;
    privacyType: string;
    onSave: (propertyType: string, privacyType: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [type, setType] = useState(propertyType);
    const [listing, setListing] = useState(privacyType);

    const openPanel = () => { setType(propertyType); setListing(privacyType || 'Entire place'); setOpen(true); };
    const { common, unique } = pickerTypes(propertyType);
    const current = propertyTypeByName(propertyType);
    const summary = [listingTypeLabel(privacyType), current ? current.label : propertyType].filter(Boolean).join(' · ');
    const blurb = (LISTING_TYPES.find((t) => t.value === listing) || LISTING_TYPES[0]).blurb;

    return (
        <>
            <EditorCard title="Property type" summary={summary} onClick={openPanel} />
            {open && (
                <EditorPanel
                    title="Property type"
                    onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={() => { onSave(type, listing); setOpen(false); }} disabled={!type} />}
                >
                    <div className="space-y-5">
                        <Select id="pt-type" label="Property type" value={type} onChange={setType}>
                            {!type && <option value="">Select one</option>}
                            {type && !propertyTypeByName(type) && <option value={type}>{type}</option>}
                            {common.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
                            <optgroup label={UNIQUE_STAYS_HEADING}>
                                {unique.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
                            </optgroup>
                        </Select>
                        <div>
                            <Select id="pt-listing" label="Listing type" value={listing} onChange={setListing}>
                                {LISTING_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </Select>
                            <p className="mt-2 text-sm text-slate-500">{blurb}</p>
                        </div>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}
