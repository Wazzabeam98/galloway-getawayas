'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Home, Sparkles, Wrench, X, ArrowRight, ArrowLeft, Check, Plus, Minus } from 'lucide-react';
import { GUEST_REGIONS } from '@/lib/strings';

// Register your interest — the same Airbnb shape as the /business fork and the
// provider wizard: a full-screen takeover, one question per screen, the three
// tiles matching the fork exactly. It should read like the platform they are
// signing up to, not a contact form. It posts to /api/interest, which stores
// the row (a table no browser role can read) and emails the owner.

type CategoryKey = 'holiday_let' | 'guest_experience' | 'tradesman';

const CHOICES: { key: CategoryKey; title: string; Icon: typeof Home }[] = [
    { key: 'holiday_let', title: 'A holiday let', Icon: Home },
    { key: 'guest_experience', title: 'A guest experience', Icon: Sparkles },
    { key: 'tradesman', title: 'A service or trade', Icon: Wrench },
];

// The last step is 'extra': a number-of-properties stepper on the holiday-let
// path, the free-text "anything else" on the guest-experience and tradesman
// paths (a let has a countable answer; the others do not).
type StepId = 'category' | 'name' | 'email' | 'phone' | 'region' | 'extra';
const STEPS: StepId[] = ['category', 'name', 'email', 'phone', 'region', 'extra'];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function RegisterInterest() {
    const [step, setStep] = useState(0);
    const [done, setDone] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [category, setCategory] = useState<CategoryKey | null>(null);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [region, setRegion] = useState<string | null>(null);
    const [notes, setNotes] = useState('');
    // Holiday-let only: number of properties. Starts at 1 (a let has at least
    // one) and the stepper cannot go below it.
    const [propertyCount, setPropertyCount] = useState(1);
    // Honeypot: a real person never fills this; kept off-screen, not hidden from
    // the accessibility tree in a way a bot would notice.
    const [company, setCompany] = useState('');

    const id = STEPS[step];

    // Whether the current screen's answer lets Next arm. notes is optional.
    const canAdvance = (() => {
        switch (id) {
            case 'category': return category !== null;
            case 'name': return name.trim().length > 0;
            case 'email': return EMAIL_RE.test(email.trim());
            case 'phone': return phone.trim().length > 0;
            case 'region': return region !== null;
            case 'extra': return true; // stepper defaults to 1; notes optional
            default: return false;
        }
    })();

    const isLast = step === STEPS.length - 1;

    async function submit() {
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch('/api/interest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category, name, email, phone, region, company,
                    // By path: a count for a holiday let, free text for the rest.
                    notes: category === 'holiday_let' ? null : notes,
                    propertyCount: category === 'holiday_let' ? propertyCount : null,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.ok) {
                setError((data && data.error) || 'Something went wrong. Please try again.');
                setSubmitting(false);
                return;
            }
            setDone(true);
        } catch {
            setError('We could not reach the server. Please try again.');
            setSubmitting(false);
        }
    }

    function next() {
        if (!canAdvance) return;
        if (isLast) { submit(); return; }
        setError(null);
        setStep((s) => s + 1);
    }

    function back() {
        setError(null);
        if (step === 0) return;
        setStep((s) => s - 1);
    }

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
            <header className="flex h-16 flex-none items-center justify-between border-b border-slate-100 px-5 sm:px-8">
                <Link href="/" className="text-sm font-bold tracking-tight text-slate-900">
                    Galloway Getaways
                </Link>
                <Link
                    href="/"
                    aria-label="Close"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                    <X className="h-5 w-5" />
                </Link>
            </header>

            {/* Thin progress line — the wizard's, so this reads as part of it. */}
            {!done && (
                <div className="h-1 flex-none bg-slate-100">
                    <div
                        className="h-full bg-emerald-600 transition-all duration-300"
                        style={{ width: ((step + 1) / STEPS.length) * 100 + '%' }}
                    />
                </div>
            )}

            <main className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-10">
                {done ? (
                    <div className="mx-auto max-w-lg text-center">
                        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
                            <Check className="h-8 w-8 text-emerald-600" />
                        </span>
                        <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
                            You&rsquo;re on the list
                        </h1>
                        <p className="mt-3 text-base leading-relaxed text-slate-500">
                            Thanks{name ? ', ' + name.trim().split(' ')[0] : ''} — we&rsquo;ll be in touch as soon as we open in
                            your part of Dumfries &amp; Galloway.
                        </p>
                        <Link
                            href="/"
                            className="mt-8 inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                        >
                            Back to the site
                        </Link>
                    </div>
                ) : (
                    <div className="w-full max-w-4xl">
                        {/* Honeypot: off-screen, not for humans. */}
                        <div aria-hidden className="absolute left-[-9999px] top-[-9999px]" style={{ opacity: 0 }}>
                            <label>
                                Company
                                <input
                                    type="text"
                                    tabIndex={-1}
                                    autoComplete="off"
                                    value={company}
                                    onChange={(e) => setCompany(e.target.value)}
                                />
                            </label>
                        </div>

                        {id === 'category' && (
                            <>
                                <Heading
                                    title="What would you register interest in?"
                                    sub="We&rsquo;re opening to hosts and trades across Dumfries &amp; Galloway soon."
                                />
                                <div className="mt-12 grid gap-5 sm:grid-cols-3">
                                    {CHOICES.map(({ key, title, Icon }) => {
                                        const isOn = category === key;
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                aria-pressed={isOn}
                                                onClick={() => setCategory(key)}
                                                className={
                                                    'group flex flex-col items-center gap-6 rounded-3xl border-2 bg-white px-6 py-10 text-center transition '
                                                    + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 '
                                                    + (isOn
                                                        ? 'border-emerald-600 shadow-md'
                                                        : 'border-slate-200 hover:border-slate-300 hover:shadow-md')
                                                }
                                            >
                                                <span className="flex h-28 items-center justify-center sm:h-36">
                                                    <Icon className="h-16 w-16 text-emerald-600 sm:h-24 sm:w-24" strokeWidth={1.5} aria-hidden />
                                                </span>
                                                <span className="text-lg font-semibold text-slate-900">{title}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}

                        {id === 'name' && (
                            <FieldScreen title="What&rsquo;s your name?" sub="So we know who we&rsquo;re speaking to.">
                                <TextInput value={name} onChange={setName} onEnter={next} placeholder="Your name" autoFocus />
                            </FieldScreen>
                        )}

                        {id === 'email' && (
                            <FieldScreen title="What&rsquo;s your email?" sub="Where we&rsquo;ll let you know the moment we open.">
                                <TextInput value={email} onChange={setEmail} onEnter={next} placeholder="you@example.com" type="email" autoFocus />
                            </FieldScreen>
                        )}

                        {id === 'phone' && (
                            <FieldScreen title="And a phone number?" sub="Handy if we want to talk it through.">
                                <TextInput value={phone} onChange={setPhone} onEnter={next} placeholder="Your phone number" type="tel" autoFocus />
                            </FieldScreen>
                        )}

                        {id === 'region' && (
                            <>
                                <Heading
                                    title="Roughly where are you?"
                                    sub="It tells us where the interest is — the same areas you&rsquo;d pick signing up."
                                />
                                <div className="mx-auto mt-10 grid max-w-2xl gap-3">
                                    {GUEST_REGIONS.map((r) => {
                                        const isOn = region === r.key;
                                        return (
                                            <button
                                                key={r.key}
                                                type="button"
                                                aria-pressed={isOn}
                                                onClick={() => setRegion(r.key)}
                                                className={
                                                    'flex items-center justify-between rounded-2xl border-2 bg-white px-5 py-4 text-left transition '
                                                    + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 '
                                                    + (isOn
                                                        ? 'border-emerald-600 shadow-sm'
                                                        : 'border-slate-200 hover:border-slate-300')
                                                }
                                            >
                                                <span>
                                                    <span className="block text-base font-semibold text-slate-900">{r.label}</span>
                                                    <span className="block text-sm text-slate-500">{r.hint}</span>
                                                </span>
                                                {isOn && <Check className="h-5 w-5 flex-none text-emerald-600" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}

                        {id === 'extra' && category === 'holiday_let' && (
                            <>
                                <Heading
                                    title="How many properties do you have?"
                                    sub="A rough number is fine &mdash; it helps us see where the lets are."
                                />
                                <div className="mt-12 flex justify-center">
                                    <Stepper value={propertyCount} onChange={setPropertyCount} min={1} max={99} />
                                </div>
                            </>
                        )}

                        {id === 'extra' && category !== 'holiday_let' && (
                            <FieldScreen
                                title="Anything else?"
                                sub="An unusual experience, another thing you offer, when you&rsquo;d like to start &mdash; whatever helps. Optional."
                            >
                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    rows={4}
                                    maxLength={1000}
                                    autoFocus
                                    placeholder="A sentence or two (optional)"
                                    className="w-full rounded-2xl border-2 border-slate-200 px-5 py-4 text-lg text-slate-900 transition placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                                />
                            </FieldScreen>
                        )}

                        {error && (
                            <p className="mx-auto mt-6 max-w-xl text-center text-sm font-medium text-rose-600">{error}</p>
                        )}
                    </div>
                )}
            </main>

            {!done && (
                <footer className="flex flex-none items-center justify-between border-t border-slate-100 px-5 py-4 sm:px-8">
                    <button
                        type="button"
                        onClick={back}
                        disabled={step === 0}
                        className={
                            'inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition '
                            + (step === 0 ? 'invisible' : 'text-slate-600 hover:bg-slate-100')
                        }
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back
                    </button>
                    <button
                        type="button"
                        disabled={!canAdvance || submitting}
                        onClick={next}
                        className={
                            'inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold transition '
                            + (canAdvance && !submitting
                                ? 'bg-slate-900 text-white hover:bg-slate-800'
                                : 'cursor-not-allowed bg-slate-200 text-slate-400')
                        }
                    >
                        {submitting ? 'Sending…' : isLast ? 'Register my interest' : 'Next'}
                        {!submitting && <ArrowRight className="h-4 w-4" />}
                    </button>
                </footer>
            )}
        </div>
    );
}

function Heading({ title, sub }: { title: string; sub: string }) {
    return (
        <div className="mx-auto max-w-xl text-center">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
            <p className="mt-3 text-base leading-relaxed text-slate-500">{sub}</p>
        </div>
    );
}

function FieldScreen({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
    return (
        <div>
            <Heading title={title} sub={sub} />
            <div className="mx-auto mt-10 max-w-md">{children}</div>
        </div>
    );
}

function TextInput({
    value, onChange, onEnter, placeholder, type = 'text', autoFocus,
}: {
    value: string;
    onChange: (v: string) => void;
    onEnter: () => void;
    placeholder: string;
    type?: string;
    autoFocus?: boolean;
}) {
    return (
        <input
            type={type}
            value={value}
            autoFocus={autoFocus}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } }}
            className="w-full rounded-2xl border-2 border-slate-200 px-5 py-4 text-center text-lg text-slate-900 transition placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
        />
    );
}

// A big display number with a minus and a plus circle either side — the same
// stepper the sign-up wizard uses for the years screen (NumberStepper, size lg),
// sized down on a phone so the numeral and both circles fit a 375px screen.
function Stepper({
    value, onChange, min = 0, max = 999,
}: {
    value: number;
    onChange: (n: number) => void;
    min?: number;
    max?: number;
}) {
    const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
    const circle =
        'flex h-14 w-14 flex-none items-center justify-center rounded-full border border-slate-300 '
        + 'text-slate-600 transition hover:border-slate-500 focus:outline-none focus-visible:ring-2 '
        + 'focus-visible:ring-emerald-600 disabled:opacity-40 disabled:hover:border-slate-300 sm:h-16 sm:w-16';
    return (
        <div className="flex items-center gap-6 sm:gap-10">
            <button type="button" onClick={() => onChange(clamp(value - 1))} disabled={value <= min}
                aria-label="Fewer" className={circle}>
                <Minus className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2} />
            </button>
            <input
                type="number"
                inputMode="numeric"
                aria-label="Number of properties"
                value={String(value)}
                onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(clamp(n)); }}
                className="w-28 bg-transparent text-center text-7xl font-extrabold tabular-nums text-slate-900 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none sm:w-44 sm:text-9xl"
            />
            <button type="button" onClick={() => onChange(clamp(value + 1))} disabled={value >= max}
                aria-label="More" className={circle}>
                <Plus className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2} />
            </button>
        </div>
    );
}
