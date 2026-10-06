'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';

// Airbnb's "Number of guests" card: "7 guests · 4 beds · 1 bathroom", opening
// to the counters. Beds can't drop below the beds already placed in sleeping
// arrangements (minBeds) — that total is what the rooms are placed against.

function plural(n: number, word: string) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function capacitySummary(guests: number, beds: number, bathrooms: number): string {
    return [plural(guests, 'guest'), plural(beds, 'bed'), plural(bathrooms, 'bathroom')].join(' · ');
}

function Counter({ label, value, onChange, min }: { label: string; value: number; onChange: (v: number) => void; min: number }) {
    return (
        <div className="flex items-center justify-between py-4 border-b border-slate-100 last:border-b-0">
            <span className="font-medium text-slate-800">{label}</span>
            <div className="flex items-center space-x-4">
                <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={'Fewer ' + label.toLowerCase()}
                    className="w-8 h-8 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900 disabled:opacity-30">
                    <Minus className="w-4 h-4" />
                </button>
                <span className="w-6 text-center">{value}</span>
                <button type="button" onClick={() => onChange(value + 1)} aria-label={'More ' + label.toLowerCase()}
                    className="w-8 h-8 rounded-full border flex items-center justify-center text-slate-600 hover:border-slate-900">
                    <Plus className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

export default function CapacityCard({ guests, beds, bathrooms, minBeds, onSave }: {
    guests: number;
    beds: number;
    bathrooms: number;
    minBeds: number;
    onSave: (guests: number, beds: number, bathrooms: number) => unknown;
}) {
    const [open, setOpen] = useState(false);
    const [g, setG] = useState(guests);
    const [b, setB] = useState(beds);
    const [ba, setBa] = useState(bathrooms);

    const openPanel = () => { setG(guests); setB(beds); setBa(bathrooms); setOpen(true); };

    return (
        <>
            <EditorCard title="Capacity" summary={capacitySummary(guests, beds, bathrooms)} onClick={openPanel} />
            {open && (
                <EditorPanel title="Capacity" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(g, b, ba))) setOpen(false); }} />}>
                    <Counter label="Guests" value={g} onChange={setG} min={1} />
                    <Counter label="Beds" value={b} onChange={setB} min={Math.max(1, minBeds)} />
                    <Counter label="Bathrooms" value={ba} onChange={setBa} min={0.5} />
                </EditorPanel>
            )}
        </>
    );
}
