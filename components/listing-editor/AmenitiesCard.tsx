'use client';

import { useState, type ComponentType } from 'react';
import { Check } from 'lucide-react';
import { EditorCard, EditorPanel, saved } from '@/components/listing-editor/EditorPanel';

export type AmenityCategory = { category: string; items: { name: string; icon: ComponentType<{ className?: string }>; note?: string }[] };

// The amenity tiles, grouped. Desktop shows them in the page (a tap saves);
// a phone shows them inside the Amenities sheet.
export function AmenityGrid({ categories, selected, onToggle }: {
    categories: AmenityCategory[];
    selected: string[];
    onToggle: (name: string) => void;
}) {
    return (
        <div className="space-y-6">
            {categories.map(({ category, items }) => (
                <div key={category}>
                    <h3 className="font-semibold text-slate-800 text-sm mb-2">{category}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {items.map(({ name, icon: Icon, note }) => {
                            const on = selected.includes(name);
                            return (
                                <button key={name} type="button" onClick={() => onToggle(name)} aria-pressed={on}
                                    className={`p-3 rounded-2xl border-2 text-left transition relative ${on ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                                    <Icon className="w-4 h-4 mb-2 text-slate-700" />
                                    <div className="text-xs font-semibold text-slate-900">{name}</div>
                                    {note && <div className="text-[10px] text-slate-400 mt-0.5">{note}</div>}
                                    {on && <Check className="w-4 h-4 text-slate-900 absolute top-3 right-3" />}
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
                <EditorPanel title="Amenities" onClose={() => setOpen(false)}
                    footer={
                        <div className="flex items-center justify-between">
                            <button type="button" onClick={() => setOpen(false)} className="text-sm font-semibold text-slate-900 underline">Cancel</button>
                            <button type="button" onClick={save} disabled={busy}
                                className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
                                {busy ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    }>
                    <p className="text-sm text-slate-500 mb-4">{draft.length} selected</p>
                    <AmenityGrid categories={categories} selected={draft} onToggle={toggle} />
                </EditorPanel>
            )}
        </>
    );
}
