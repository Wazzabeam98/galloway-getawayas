'use client';

import { Minus, Plus } from 'lucide-react';
import { durationWords } from '@/lib/durationWords';
import { useQuestionSheets } from '@/components/listing-editor/questionSheets';
import { ChoiceTiles, NumberStepper } from './wizardKit';

// The shared pick-from-options / stepper controls for the guest-experience
// surfaces — the listing editor and the diary scheduler both use these, so a
// provider meets one design language wherever they set a number or a choice.

// A row of pick-from-options pills — one clear choice, no typing. The chosen
// value is highlighted in the emerald selection style used across the editor.
export function OptionPills({ options, value, onChange }: {
    options: { value: string; label: string }[]; value: string; onChange: (v: string) => void;
}) {
    // In a question sheet, the wizard's large choice tiles.
    if (useQuestionSheets()) return <ChoiceTiles options={options} value={value} onChange={onChange} cols={options.length > 4 ? 3 : 2} />;
    return (
        <div className="flex flex-wrap gap-2">
            {options.map((o) => {
                const on = value === o.value;
                return (
                    <button key={o.value} type="button" onClick={() => onChange(o.value)}
                        aria-pressed={on}
                        className={`rounded-xl border px-4 py-2 text-sm transition ${on ? 'border-emerald-700 ring-2 ring-emerald-700 bg-emerald-50 text-slate-900' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}>
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

// A +/- counter for a plain count like group size — a number a guest reads as
// "up to N", not a free-text box.
export function Stepper({ value, onChange, min = 1, max = 60 }: {
    value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
    // In a question sheet, the wizard's big − and + counter.
    if (useQuestionSheets()) {
        return (
            <div className="flex justify-center">
                <NumberStepper value={String(value)} onChange={(v) => onChange(Number(v))} min={min} max={max} size="lg" solid />
            </div>
        );
    }
    return (
        <div className="flex items-center gap-4">
            <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
                className="flex h-9 w-9 items-center justify-center rounded-full border text-slate-600 hover:border-slate-900 disabled:opacity-30">
                <Minus className="h-4 w-4" />
            </button>
            <span className="w-8 text-center text-lg font-semibold text-slate-900">{value}</span>
            <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}
                className="flex h-9 w-9 items-center justify-center rounded-full border text-slate-600 hover:border-slate-900 disabled:opacity-30">
                <Plus className="h-4 w-4" />
            </button>
        </div>
    );
}

// Common session lengths, read the one way everywhere (lib/durationWords):
// "90" -> "90 min", "150" -> "2 hr 30 min".
export const SESSION_LENGTH_OPTIONS = [30, 45, 60, 90, 120];
export function minutesLabel(m: number): string {
    return durationWords(m);
}
