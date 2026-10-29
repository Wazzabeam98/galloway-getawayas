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

// Session length is set on a PLAIN-MINUTES counter now (Liam, 28 Oct 2026): a
// big number and a "minutes" label, the same control everywhere a provider sets
// a length — the sign-up wizard, the listing editor and each per-option duration
// — so sign-up and the editor match. (Guest-facing listing pages still read a
// length as "1 hr 30 min" via durationWords.) The counter steps in 5 up to an
// hour and 10 from an hour upwards, so an 18-hole round (240) is as quick to dial
// in as a 20-minute taster. Going DOWN at exactly 60 steps by 5 (to 55), so the
// grid below the hour stays on fives.
export const SESSION_LENGTH_MIN = 15;
export const SESSION_LENGTH_MAX = 480;
export const SESSION_LENGTH_SUFFIX = 'minutes';
export function sessionLengthStep(current: number, dir: 1 | -1): number {
    return dir > 0 ? (current < 60 ? 5 : 10) : (current <= 60 ? 5 : 10);
}
// The PROVIDER-facing label for an already-set length — plain minutes ("90 min"),
// matching the counter. Distinct from durationWords, which the guest listing uses
// ("1 hr 30 min").
export function sessionMinutesLabel(m: number): string {
    return `${Math.round(Number(m) || 0)} min`;
}
