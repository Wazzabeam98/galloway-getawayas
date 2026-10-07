'use client';

import { useState } from 'react';
import { EditorCard, EditorPanel, PanelSave, saved } from '@/components/listing-editor/EditorPanel';
import { NumberStepper } from '@/components/services/wizardKit';

// Airbnb's "Number of guests" card: "7 guests · 4 beds · 1 bathroom", opening
// to the counters. Beds can't drop below the beds already placed in sleeping
// arrangements (minBeds) — that total is what the rooms are placed against.

function plural(n: number, word: string) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function capacitySummary(guests: number, beds: number, bathrooms: number): string {
    return [plural(guests, 'guest'), plural(beds, 'bed'), plural(bathrooms, 'bathroom')].join(' · ');
}

// One count: its label, then the add flow's big − and + counter.
function Counter({ label, value, onChange, min }: { label: string; value: number; onChange: (v: number) => void; min: number }) {
    return (
        <div className="flex flex-col items-center gap-2" role="group" aria-label={label}>
            <span className="text-base font-semibold text-slate-800">{label}</span>
            <NumberStepper value={String(value)} onChange={(v) => onChange(Math.max(min, Number(v) || min))} min={min} max={99} solid />
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
                <EditorPanel title="How many guests, beds and bathrooms?" onClose={() => setOpen(false)}
                    footer={<PanelSave onClick={async () => { if (await saved(onSave(g, b, ba))) setOpen(false); }} />}>
                    <div className="space-y-8">
                        <Counter label="Guests" value={g} onChange={setG} min={1} />
                        <Counter label="Beds" value={b} onChange={setB} min={Math.max(1, minBeds)} />
                        <Counter label="Bathrooms" value={ba} onChange={setBa} min={0.5} />
                    </div>
                </EditorPanel>
            )}
        </>
    );
}
