'use client';

import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { ChevronLeft, X, Mail } from 'lucide-react';
import GoogleButton from '@/components/auth/GoogleButton';
import { supabaseEmailFlow } from '@/lib/supabaseEmailFlow';
import {
    CODE_MAX_LENGTH,
    logInWithPassword,
    looksLikeEmail,
    needsName,
    sendCode,
    tidyCode,
    tidyEmail,
    verifyCode,
} from '@/lib/emailCodeSignIn';
import { agreementProblem, versionForTick } from '@/lib/agreements';
import AgreementTick, { fetchAgreementStatus, holdAgreementGate, recordAgreement } from '@/components/legal/AgreementTick';

/**
 * The shared first step of every sign-up: "What's your email?".
 *
 * A full-page takeover in the sign-up wizard's own style (top bar with Back,
 * brand and close; one centred column; a big heading) — not the narrow card
 * the holiday-let sign-up used to open on. The screens:
 *
 *   email    — the address, then "Continue", with Continue with Google beneath
 *   code     — the 6-digit code we emailed; resend; or "use your password"
 *   password — for an account that already has one (still works, always)
 *   name     — only if the account has no name yet (a new one never does),
 *              and/or hasn't agreed to the Guest Terms: Airbnb's "Finish
 *              signing up" — the name, and the tick box, on one screen
 *
 * Whoever is already signed in never sees any of this — the page mounting it
 * decides that, and should render its own flow straight away.
 *
 * The sign-in logic lives in lib/emailCodeSignIn, shared with the guest and
 * trade flows.
 */

type Screen = 'email' | 'code' | 'password' | 'name';

interface Props {
    // Small emerald label over the heading, naming the flow ("List your place").
    eyebrow: string;
    // One line under "What's your email?" saying why we're asking.
    intro: ReactNode;
    // Where Back (on the first screen) and the close X go.
    exitHref: string;
    // Called once the person is signed in and, if needed, named.
    onSignedIn: (session: any) => void;
    // Pre-fills the address, where the page already knows it (an emailed link).
    initialEmail?: string;
}

const INPUT = 'w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-700';
const PRIMARY = 'w-full rounded-xl px-6 py-3 text-sm font-semibold transition bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed';
const LINK = 'font-semibold text-slate-900 underline underline-offset-2 hover:text-emerald-800 disabled:opacity-60';

// How long "Send a new code" stays greyed after a send. Supabase refuses a
// second code to the same address inside 60 seconds anyway; saying so up front
// beats letting the press fail.
const RESEND_WAIT_SECONDS = 60;

export default function EmailFirstStep({ eyebrow, intro, exitHref, onSignedIn, initialEmail = '' }: Props) {
    const supabase = createClientComponentClient();
    const [screen, setScreen] = useState<Screen>('email');
    const [email, setEmail] = useState(initialEmail);
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [wait, setWait] = useState(0);
    const [session, setSession] = useState<any>(null);
    // The last screen asks for whichever of these the account is missing.
    const [askName, setAskName] = useState(true);
    const [askTerms, setAskTerms] = useState(false);
    const [termsTicked, setTermsTicked] = useState(false);
    const [termsError, setTermsError] = useState('');
    const firstField = useRef<HTMLInputElement>(null);

    // This screen asks for the Guest Terms itself, so the site-wide
    // sign-in prompt stays out of the way while it is up.
    useEffect(() => holdAgreementGate(), []);

    useEffect(() => {
        firstField.current?.focus();
    }, [screen]);

    useEffect(() => {
        if (wait <= 0) return;
        const t = setTimeout(() => setWait(wait - 1), 1000);
        return () => clearTimeout(t);
    }, [wait]);

    const go = (next: Screen) => {
        setError('');
        setNotice('');
        setScreen(next);
    };

    const goBack = () => {
        if (screen === 'code' || screen === 'password') {
            setCode('');
            setPassword('');
            go('email');
        }
    };

    // Signed in. Ask for a name only if the account has none, and for the
    // Guest Terms only if it hasn't agreed to the current version — a new
    // account never has either.
    const afterSignIn = async (s: any) => {
        setSession(s);
        const [{ data: prof }, status] = await Promise.all([
            supabase.from('profiles').select('full_name').eq('id', s.user.id).maybeSingle(),
            fetchAgreementStatus(),
        ]);
        const wantName = needsName(prof?.full_name);
        const wantTerms = !!(status && status.documents.guest && !status.documents.guest.agreed);
        if (wantName || wantTerms) {
            setAskName(wantName);
            setAskTerms(wantTerms);
            setBusy(false);
            go('name');
            return;
        }
        onSignedIn(s);
    };

    const submitEmail = async (e?: FormEvent) => {
        e?.preventDefault();
        if (!looksLikeEmail(email)) {
            setError('Enter your email address.');
            return;
        }
        setBusy(true);
        setError('');
        const r = await sendCode(supabase, email);
        setBusy(false);
        if (!r.ok) {
            setError(r.message);
            return;
        }
        setCode('');
        setWait(RESEND_WAIT_SECONDS);
        go('code');
    };

    const resend = async () => {
        setBusy(true);
        setError('');
        setNotice('');
        const r = await sendCode(supabase, email);
        setBusy(false);
        if (!r.ok) {
            setError(r.message);
            return;
        }
        setCode('');
        setWait(RESEND_WAIT_SECONDS);
        setNotice('New code sent. Use the latest one — earlier codes stop working.');
    };

    const submitCode = async (e?: FormEvent) => {
        e?.preventDefault();
        setBusy(true);
        setError('');
        const r = await verifyCode(supabase, email, code);
        if (!r.ok) {
            setBusy(false);
            setError(r.message);
            return;
        }
        await afterSignIn(r.value);
    };

    const submitPassword = async (e?: FormEvent) => {
        e?.preventDefault();
        setBusy(true);
        setError('');
        const r = await logInWithPassword(supabase, email, password);
        if (!r.ok) {
            setBusy(false);
            setError(r.message);
            return;
        }
        await afterSignIn(r.value);
    };

    const forgotPassword = async () => {
        setBusy(true);
        setError('');
        setNotice('');
        // Same reset route the login modal uses, so the link works on any device.
        const { error: err } = await supabaseEmailFlow().auth.resetPasswordForEmail(tidyEmail(email), {
            redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset`,
        });
        setBusy(false);
        if (err && (err.status === 429 || /rate limit|security purposes/i.test(err.message || ''))) {
            setError('We can’t send another email just yet. Wait a minute and try again.');
            return;
        }
        // Worded the same whether or not the address has an account.
        setNotice(`If ${tidyEmail(email)} has a password, we’ve emailed a link to reset it.`);
    };

    const submitName = async (e?: FormEvent) => {
        e?.preventDefault();
        const full = name.trim();
        if (askName && !full) {
            setError('Enter your name.');
            return;
        }
        // The same rule /api/agreements applies to the record below.
        const termsMsg = askTerms ? agreementProblem('guest', null, versionForTick('guest', termsTicked)) : null;
        if (termsMsg) {
            setTermsError(termsMsg);
            return;
        }
        setBusy(true);
        setError('');
        if (askName) {
            const { error: err } = await supabase.from('profiles').update({ full_name: full }).eq('id', session.user.id);
            if (err) {
                setBusy(false);
                setError('We couldn’t save your name. Check your connection and try again.');
                return;
            }
            // Mirror it onto the auth user too, which is where the rest of the
            // page reads a greeting name from before the profile is loaded.
            await supabase.auth.updateUser({ data: { name: full } });
        }
        if (askTerms) {
            const failed = await recordAgreement('guest', 'signup');
            if (failed) {
                setBusy(false);
                setTermsError(failed);
                return;
            }
        }
        onSignedIn(session);
    };

    const heading =
        screen === 'email' ? 'What’s your email?'
            : screen === 'code' ? 'Enter your code'
                : screen === 'password' ? 'Log in with your password'
                    : askName ? (askTerms ? 'Finish signing up' : 'What’s your name?') : 'One more thing';

    const backButton = 'inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition';

    return (
        <div className="fixed inset-0 z-[60] flex flex-col bg-white">
            {/* Same top bar as the guest-experience wizard: Back, brand, a way out. */}
            <div className="shrink-0 border-b border-slate-100 px-4 sm:px-8">
                <div className="flex h-16 items-center justify-between gap-3">
                    {screen === 'code' || screen === 'password' ? (
                        <button type="button" onClick={goBack} className={backButton}>
                            <ChevronLeft className="h-5 w-5" /> Back
                        </button>
                    ) : screen === 'email' ? (
                        <Link href={exitHref} className={backButton}>
                            <ChevronLeft className="h-5 w-5" /> Back
                        </Link>
                    ) : (
                        // Signed in by now — there's nothing to go back to.
                        <span className="w-[76px]" aria-hidden="true" />
                    )}
                    <span className="text-sm font-bold tracking-tight text-slate-900">Galloway Getaways</span>
                    <Link href={exitHref} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition">
                        <X className="h-5 w-5" />
                    </Link>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-md px-4 pb-16 pt-10 sm:px-6 sm:pt-20">
                    <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-emerald-700">{eyebrow}</p>
                    <h1 className="mb-3 text-3xl font-extrabold tracking-tight text-slate-900 [text-wrap:balance] sm:text-4xl">
                        {heading}
                    </h1>

                    {screen === 'email' && (
                        <>
                            <p className="mb-8 text-slate-600 [text-wrap:pretty]">{intro}</p>
                            <form onSubmit={submitEmail} className="space-y-4" noValidate>
                                <div>
                                    <label htmlFor="efs-email" className="mb-2 block text-xs font-medium text-slate-500">Email</label>
                                    <input
                                        ref={firstField}
                                        id="efs-email"
                                        type="email"
                                        inputMode="email"
                                        autoComplete="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="you@example.com"
                                        className={INPUT}
                                    />
                                </div>
                                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                                <button type="submit" disabled={busy || !email.trim()} className={PRIMARY}>
                                    {busy ? 'Sending your code…' : 'Continue'}
                                </button>
                            </form>
                            <GoogleButton
                                divider={
                                    <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
                                        <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
                                    </div>
                                }
                            />
                            <p className="mt-8 text-sm text-slate-500">
                                We’ll email you a 6-digit code. New here? That makes your account; already with us? It signs you in.{' '}
                                <button
                                    type="button"
                                    onClick={() => (looksLikeEmail(email) ? go('password') : setError('Enter your email address first.'))}
                                    className={LINK}
                                >
                                    Log in with a password instead
                                </button>
                            </p>
                        </>
                    )}

                    {screen === 'code' && (
                        <>
                            <p className="mb-8 flex items-start gap-2 text-slate-600 [text-wrap:pretty]">
                                <Mail className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                                <span>We sent a 6-digit code to <span className="font-semibold text-slate-900 break-all">{tidyEmail(email)}</span>.</span>
                            </p>
                            <form onSubmit={submitCode} className="space-y-4" noValidate>
                                <div>
                                    <label htmlFor="efs-code" className="mb-2 block text-xs font-medium text-slate-500">Code</label>
                                    <input
                                        ref={firstField}
                                        id="efs-code"
                                        type="text"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        maxLength={CODE_MAX_LENGTH + 4}
                                        value={code}
                                        onChange={(e) => setCode(tidyCode(e.target.value))}
                                        placeholder="123456"
                                        className={INPUT + ' text-center text-2xl tracking-[0.3em]'}
                                    />
                                </div>
                                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                                {notice && <p className="text-sm text-emerald-800">{notice}</p>}
                                <button type="submit" disabled={busy || code.length < 6} className={PRIMARY}>
                                    {busy ? 'Checking…' : 'Continue'}
                                </button>
                            </form>
                            <div className="mt-8 space-y-2 text-sm text-slate-500">
                                <p>
                                    No code? Check spam, or{' '}
                                    <button type="button" onClick={resend} disabled={busy || wait > 0} className={LINK}>
                                        {wait > 0 ? `send a new one in ${wait}s` : 'send a new one'}
                                    </button>.
                                </p>
                                <p>
                                    Have a password?{' '}
                                    <button type="button" onClick={() => go('password')} className={LINK}>Use it instead</button>
                                </p>
                            </div>
                        </>
                    )}

                    {screen === 'password' && (
                        <>
                            <p className="mb-8 text-slate-600">
                                For <span className="font-semibold text-slate-900 break-all">{tidyEmail(email)}</span>.
                            </p>
                            <form onSubmit={submitPassword} className="space-y-4" noValidate>
                                <div>
                                    <label htmlFor="efs-password" className="mb-2 block text-xs font-medium text-slate-500">Password</label>
                                    <input
                                        ref={firstField}
                                        id="efs-password"
                                        type="password"
                                        autoComplete="current-password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className={INPUT}
                                    />
                                </div>
                                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                                {notice && <p className="text-sm text-emerald-800">{notice}</p>}
                                <button type="submit" disabled={busy || !password} className={PRIMARY}>
                                    {busy ? 'Logging in…' : 'Log in'}
                                </button>
                            </form>
                            <div className="mt-8 space-y-2 text-sm text-slate-500">
                                <p>
                                    <button type="button" onClick={forgotPassword} disabled={busy} className={LINK}>Forgotten your password?</button>
                                </p>
                                <p>
                                    Or{' '}
                                    <button type="button" onClick={() => submitEmail()} disabled={busy} className={LINK}>email me a code instead</button>
                                </p>
                            </div>
                        </>
                    )}

                    {screen === 'name' && (
                        <>
                            <p className="mb-8 text-slate-600 [text-wrap:pretty]">
                                {askName
                                    ? 'You’re signed in. This is the name guests and our team will see on your account.'
                                    : 'You’re signed in. Before you carry on, please read and agree to our Guest Terms.'}
                            </p>
                            <form onSubmit={submitName} className="space-y-4" noValidate>
                                {askName && (
                                    <div>
                                        <label htmlFor="efs-name" className="mb-2 block text-xs font-medium text-slate-500">Full name</label>
                                        <input
                                            ref={firstField}
                                            id="efs-name"
                                            type="text"
                                            autoComplete="name"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            className={INPUT}
                                        />
                                    </div>
                                )}
                                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                                {askTerms && (
                                    <AgreementTick
                                        doc="guest"
                                        id="efs-agree-guest"
                                        checked={termsTicked}
                                        onChange={(v) => { setTermsTicked(v); setTermsError(''); }}
                                        error={termsError}
                                    />
                                )}
                                <button type="submit" disabled={busy || (askName && !name.trim())} className={PRIMARY}>
                                    {busy ? 'Saving…' : askTerms ? 'Agree and continue' : 'Continue'}
                                </button>
                            </form>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
