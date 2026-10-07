'use client';

import { useState, type ComponentType } from 'react';
import { Check } from 'lucide-react';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';

export type AmenityCategory = { category: string; items: { name: string; icon: ComponentType<{ className?: string }>; note?: string }[] };

// The amenity tiles, grouped. Desktop shows them in the page (a tap saves);
// a phone shows them inside the Amenities sheet.
export function AmenityGrid({ categories, selected, onToggle, large = false }: {
    categories: AmenityCategory[];
    selected: string[];
    onToggle: (name: string) => void;
    // The phone sheet: the add flow's large tiles. Desktop's in-page grid stays as it is.
    large?: boolean;
}) {
    return (
        <div className="space-y-6">
            {categories.map(({ category, items }) => (
                <div key={category}>
                    <h3 className={`font-semibold text-slate-800 mb-2 ${large ? 'text-base' : 'text-sm'}`}>{category}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {items.map(({ name, icon: Icon, note }) => {
                            const on = selected.includes(name);
                            return (
                                <button key={name} type="button" onClick={() => onToggle(name)} aria-pressed={on}
                                    className={large
                                        ? `p-4 rounded-2xl border-2 text-left transition relative ${on ? 'border-emerald-600 bg-emerald-50/60 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`
                                        : `p-3 rounded-2xl border-2 text-left transition relative ${on ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                    <Icon className={large ? 'w-6 h-6 mb-2 text-slate-800' : 'w-4 h-4 mb-2 text-slate-700'} />
                                    <div className={large ? 'text-base font-semibold text-slate-900' : 'text-xs font-semibold text-slate-900'}>{name}</div>
                                    {note && <div className={large ? 'text-sm text-slate-500 mt-0.5' : 'text-[10px] text-slate-400 mt-0.5'}>{note}</div>}
                                    {on && <Check className={large ? 'w-5 h-5 text-emerald-700 absolute top-3 right-3' : 'w-4 h-4 text-slate-900 absolute top-3 right-3'} />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}

// "14 amenities · Wifi, Kitchen, Free parking": the ones the list offers, in
// its order. Pets and the two alarms are stored as amenities too but are set
// elsewhere (House rules, Guest safety), so they aren't counted here.
export function amenitiesSummary(categories: AmenityCategory[], selected: string[]) {
    const on = categories.flatMap((c) => c.items.map((i) => i.name)).filter((n) => selected.includes(n));
    if (!on.length) return 'None added yet';
    return `${on.length} ${on.length === 1 ? 'amenity' : 'amenities'} · ${on.slice(0, 3).join(', ')}`;
}

// On a phone, Amenities is a raised card like the rest, so scrolling past the
// tiles can never toggle one. The sheet edits a copy: Save writes it, Cancel
// (or the X) throws it away.
export default function AmenitiesCard({ categories, amenities, onSave }: {
    categories: AmenityCategory[];
    amenities: string[];
    onSave: (amenities: string[]) => unknown;
}) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<string[]>(amenities);
    const [busy, setBusy] = useState(false);
    const toggle = (name: string) => setDraft((d) => (d.includes(name) ? d.filter((a) => a !== name) : [...d, name]));
    const save = async () => {
        if (busy) return;
        setBusy(true);
        try { if (await saved(onSave(draft))) setOpen(false); } finally { setBusy(false); }
    };

    return (
        <>
            <EditorCard title="Amenities" summary={amenitiesSummary(categories, amenities)} onClick={() => { setDraft(amenities); setOpen(true); }} />
            {open && (
                <EditorPanel title="What does your place offer?" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={save} disabled={busy} />}>
                    <AmenityGrid categories={categories} selected={draft} onToggle={toggle} large />
                </EditorPanel>
            )}
        </>
    );
}
