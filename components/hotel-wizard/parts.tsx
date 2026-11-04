'use client';

import { Minus, Plus, Check } from 'lucide-react';

// Small shared widgets for the hotel wizard. The Counter mirrors /addhome's
// inline Counter (round −/+ buttons). TimeSelect is a reliable dropdown of
// half-hour times — it replaces the native/typed time field that let "1430"
// become "3000", because a dropdown cannot be given a value that is not a time.

export function Counter({ label, value, onChange, min = 0, hint }: {
    label: string; value: number; onChange: (v: number) => void; min?: number; hint?: string;
}) {
    return (
        <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
            <div>
                <div className="text-slate-900">{label}</div>
                {hint && <div className="text-xs text-slate-500">{hint}</div>}
            </div>
            <div className="flex items-center gap-3">
                <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
                    className="h-8 w-8 rounded-full border border-slate-300 text-slate-600 flex items-center justify-center disabled:opacity-30 hover:border-slate-400">
                    <Minus className="h-4 w-4" />
                </button>
                <span className="w-6 text-center tabular-nums">{value}</span>
                <button type="button" onClick={() => onChange(value + 1)}
                    className="h-8 w-8 rounded-full border border-slate-300 text-slate-600 flex items-center justify-center hover:border-slate-400">
                    <Plus className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}

// '00:00' … '23:30' in 30-minute steps.
const TIME_OPTIONS: string[] = (() => {
    const out: string[] = [];
    for (let h = 0; h < 24; h++) for (const m of [0, 30]) {
        out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
    return out;
})();

function label12(hhmm: string): string {
    const [h, m] = hhmm.split(':').map(Number);
    const period = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function TimeSelect({ value, onChange, placeholder = 'Select a time' }: {
    value: string; onChange: (v: string) => void; placeholder?: string;
}) {
    return (
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-700">
            <option value="">{placeholder}</option>
            {TIME_OPTIONS.map((t) => <option key={t} value={t}>{label12(t)}</option>)}
        </select>
    );
}

export function Toggle({ label, checked, onChange, hint }: {
    label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string;
}) {
    return (
        <button type="button" onClick={() => onChange(!checked)}
            className="w-full flex items-center justify-between py-2 text-left">
            <span className="text-sm text-slate-800">{label}{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
            <span className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-emerald-700' : 'bg-slate-300'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? 'left-5' : 'left-0.5'}`} />
            </span>
        </button>
    );
}

// A grid of multi-select chips (bathroom features, views, accessibility…).
export function CheckGroup({ options, selected, onToggle }: {
    options: string[]; selected: string[]; onToggle: (name: string) => void;
}) {
    return (
        <div className="grid grid-cols-2 gap-2">
            {options.map((name) => {
                const on = selected.includes(name);
                return (
                    <button key={name} type="button" onClick={() => onToggle(name)}
                        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm text-left transition ${on ? 'border-emerald-700 bg-emerald-50/40 text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
                        <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'bg-emerald-700 border-emerald-700 text-white' : 'border-slate-300'}`}>{on && <Check className="h-3 w-3" />}</span>
                        {name}
                    </button>
                );
            })}
        </div>
    );
}

// A single-select pill row (bathroom type, smoking).
export function PillChoice({ options, value, onChange }: {
    options: { value: string; label: string }[]; value: string; onChange: (v: string) => void;
}) {
    return (
        <div className="flex flex-wrap gap-2">
            {options.map((o) => (
                <button key={o.value} type="button" onClick={() => onChange(o.value)}
                    className={`rounded-xl border px-3.5 py-2 text-sm transition ${value === o.value ? 'border-emerald-700 bg-emerald-50/40 text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export const bigInputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-700';
