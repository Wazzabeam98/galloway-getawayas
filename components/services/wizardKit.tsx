'use client';

import { Minus, Plus, X, type LucideIcon } from 'lucide-react';
import { minutesLabel } from './editorControls';

// The guest provider sign-up wizard's reusable pieces, lifted out of
// ProviderSignUp so the experience listing editor's "+ Add an offering" flow is the
// SAME control, not a look-alike. ProviderSignUp imports NumberStepper and
// ChoiceCard from here; the editor imports all three.

// A −/+ stepper with a big display number, in the register Airbnb use for every
// count in their host flow (a guest picks a number by nudging it, not by typing
// into a small box). Used for the counts on the where-and-when step — session
// length, group size, days of notice — and, in the editor, for a duration and a
// capacity.
//
// NOTHING PERSISTS UNTIL THE HOST TOUCHES IT. `value` empty is "not set yet":
// the stepper shows `suggestion` greyed as a hint, but the stored value stays
// empty. The first nudge adopts the suggestion, and typing sets any number
// directly. The value stays a string to match the fields it replaced.
export function NumberStepper({
    value, onChange, min = 0, max = 999, step = 1, suffix, suggestion, size = 'md', solid = false, format,
}: {
    value: string;
    onChange: (v: string) => void;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    suggestion?: number;
    // 'lg' is the whole-screen opener: a huge display numeral and larger
    // buttons. 'md' is the inline count.
    size?: 'md' | 'lg';
    // solid: show the number in solid black from load — the suggestion is a
    // starting position, not a greyed placeholder. It STILL stores nothing until
    // touched. Use solid ONLY where the step is not gated (the shown default is
    // already the accepted answer).
    solid?: boolean;
    // When set, the display is this formatted label (a big read-only numeral
    // text, not an editable box) — e.g. "1 hr 30 min" for a duration. The ±
    // buttons still step by `step`.
    format?: (n: number) => string;
}) {
    const has = String(value).trim() !== '' && Number.isFinite(Number(value));
    const shown = has ? Number(value) : (suggestion ?? min);
    const commit = (n: number) => onChange(String(Math.max(min, Math.min(max, Math.round(n)))));
    const nudge = (dir: number) => ((solid || has) ? commit(shown + dir * step) : commit(suggestion ?? min));

    const lg = size === 'lg';
    const circle =
        (lg ? 'h-14 w-14 sm:h-16 sm:w-16 ' : 'h-11 w-11 ')
        + 'flex flex-none items-center justify-center rounded-full border border-slate-300 '
        + 'text-slate-600 transition hover:border-slate-500 focus:outline-none focus-visible:ring-2 '
        + 'focus-visible:ring-emerald-600 disabled:opacity-40 disabled:hover:border-slate-300';
    const glyph = lg ? 'h-5 w-5 sm:h-6 sm:w-6' : 'h-4 w-4';
    const numberField = lg
        ? 'w-28 sm:w-44 bg-transparent text-center text-7xl sm:text-9xl font-extrabold tabular-nums text-slate-900 placeholder:font-extrabold placeholder:text-slate-300 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
        : 'w-16 bg-transparent text-center text-4xl font-extrabold tabular-nums text-slate-900 placeholder:font-extrabold placeholder:text-slate-300 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';
    // A formatted display (e.g. a duration) is read-only text, sized to fit the
    // longer label rather than a single numeral.
    const labelField = lg
        ? 'min-w-[8rem] sm:min-w-[14rem] text-center text-4xl sm:text-6xl font-extrabold tabular-nums text-slate-900'
        : 'min-w-[6rem] text-center text-2xl font-extrabold tabular-nums text-slate-900';

    return (
        <div className={'flex items-center ' + (lg ? 'gap-4 sm:gap-10' : 'gap-4')}>
            <button type="button" onClick={() => nudge(-1)} disabled={has && shown <= min}
                aria-label="Decrease" className={circle}>
                <Minus className={glyph} strokeWidth={2} />
            </button>
            {format ? (
                // Greyed until touched, like the numeral's placeholder, unless solid.
                <span className={labelField + (!solid && !has ? ' !text-slate-300' : '')} aria-label="Amount">{format(shown)}</span>
            ) : (
                <input
                    type="number" inputMode="numeric" aria-label="Amount"
                    value={solid ? String(shown) : (has ? String(shown) : '')}
                    placeholder={solid ? undefined : (suggestion !== undefined ? String(suggestion) : '')}
                    onChange={(e) => onChange(e.target.value)}
                    className={numberField}
                />
            )}
            <button type="button" onClick={() => nudge(1)} disabled={has && shown >= max}
                aria-label="Increase" className={circle}>
                <Plus className={glyph} strokeWidth={2} />
            </button>
            {suffix && <span className="text-sm text-slate-500">{suffix}</span>}
        </div>
    );
}

// The one large, centred choice card every either/or fork in the guest wizard
// uses (the fulfilment fork, the slot private/shared answer, per person / whole
// session). Tall so a screenful of two or three options fills the space.
export function ChoiceCard({ selected, onSelect, title, hint, radio, icon: Icon }: {
    selected: boolean;
    onSelect: () => void;
    title: string;
    hint: string;
    radio?: boolean;
    // A large icon above the title — the sign-up wizard's illustration zone.
    icon?: LucideIcon;
}) {
    return (
        <button type="button" onClick={onSelect}
            {...(radio ? { role: 'radio', 'aria-checked': selected } : { 'aria-pressed': selected })}
            className={'flex min-h-[9rem] flex-col items-center justify-start gap-1.5 rounded-2xl border-2 bg-white px-5 py-7 text-center transition hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 sm:min-h-[13rem] sm:py-9 '
                + (selected ? 'border-emerald-600 shadow-sm' : 'border-slate-200 hover:border-slate-300')}>
            {Icon && (
                <span className="mb-1 flex h-14 items-center justify-center">
                    <Icon className={'h-11 w-11 ' + (selected ? 'text-emerald-700' : 'text-emerald-600')} strokeWidth={1.5} aria-hidden />
                </span>
            )}
            <span className="flex items-center text-lg font-semibold text-slate-900 sm:min-h-[3.5rem]">{title}</span>
            <span className="text-sm text-slate-500">{hint}</span>
        </button>
    );
}

// The sign-up wizard's price: a big numeral you TYPE into — no spinner arrows
// (nobody sets £45 by nudging up from zero) and no box; the number is the
// thing you see, the £ sits quietly at its baseline. Airbnb's price register.
// The wizard and the experience editor's Price sheet use this one control.
//   numeric: true  — the wizard's own type="number" box, passed through as typed
//   numeric: false — a text box with a decimal keypad; the caller cleans the value
export function BigAmountInput({ value, onChange, placeholder = '0', ariaLabel, numeric = true, autoFocus }: {
    value: string;
    onChange: (raw: string) => void;
    placeholder?: string;
    ariaLabel: string;
    numeric?: boolean;
    autoFocus?: boolean;
}) {
    return (
        <div className="flex items-baseline justify-center gap-2">
            <span className="text-4xl font-extrabold text-slate-400 sm:text-5xl">£</span>
            <input
                {...(numeric ? { type: 'number', min: '0', step: '0.01' } : { type: 'text', autoComplete: 'off' })}
                inputMode="decimal" value={value} autoFocus={autoFocus}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                aria-label={ariaLabel}
                className="w-48 bg-transparent text-center text-6xl font-extrabold tabular-nums text-slate-900 placeholder:font-extrabold placeholder:text-slate-300 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none sm:text-7xl"
            />
        </div>
    );
}

// "90 min" / "2 hr 30 min" — the duration label the add flow and the edit card show.
export function durationLabel(mins: number): string {
    if (!mins) return 'None';
    return minutesLabel(mins);
}

// The full-page stepped flow the sign-up wizard uses, as a reusable shell: a
// takeover with the brand and a close X, a thin progress bar, one centred
// question at a time, and Back / Next at the foot. One question per screen is
// what keeps it calm — the same register as sign-up.
export function WizardShell({ step, total, title, subtitle, onClose, onBack, onNext, nextLabel = 'Next', nextDisabled, children }: {
    step: number; // 1-based
    total: number;
    title: string;
    subtitle?: string;
    onClose: () => void;
    onBack?: () => void;
    onNext: () => void;
    nextLabel?: string;
    nextDisabled?: boolean;
    children: React.ReactNode;
}) {
    const pct = Math.round((step / Math.max(1, total)) * 100);
    return (
        <div className="fixed inset-0 z-[70] flex flex-col bg-white">
            <div className="shrink-0 border-b border-slate-100 px-4 sm:px-8">
                <div className="flex h-16 items-center justify-between gap-3">
                    <span className="w-9" aria-hidden />
                    <span className="text-sm font-bold tracking-tight text-slate-900">Galloway Getaways</span>
                    <button type="button" onClick={onClose} aria-label="Close"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition">
                        <X className="h-5 w-5" />
                    </button>
                </div>
            </div>
            {/* Progress bar */}
            <div className="h-1 w-full shrink-0 bg-slate-100">
                <div className="h-full bg-emerald-600 transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }}
                    role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={total} aria-label={`Step ${step} of ${total}`} />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-6 py-8 sm:px-10">
                    <h2 className="text-center text-2xl font-extrabold tracking-tight text-slate-900 [text-wrap:balance] sm:text-3xl">{title}</h2>
                    {subtitle && <p className="mt-2 text-center text-sm text-slate-500 [text-wrap:balance]">{subtitle}</p>}
                    <div className="flex flex-1 flex-col justify-center py-10">{children}</div>
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8">
                {onBack ? (
                    <button type="button" onClick={onBack} className="text-sm font-semibold text-slate-700 underline hover:text-slate-900">Back</button>
                ) : <span />}
                <button type="button" onClick={onNext} disabled={nextDisabled}
                    className={'rounded-full px-7 py-2.5 text-sm font-semibold transition '
                        + (nextDisabled ? 'cursor-not-allowed bg-slate-200 text-slate-400' : 'bg-emerald-700 text-white hover:bg-emerald-800')}>
                    {nextLabel}
                </button>
            </div>
        </div>
    );
}
