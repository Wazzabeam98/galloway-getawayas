'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { ArrowLeft, X } from 'lucide-react';
import { GooseMark } from '@/components/base/Logo';
import GoogleButton from '@/components/auth/GoogleButton';
import AgreementTick, { fetchAgreementStatus, holdAgreementGate, recordAgreement } from '@/components/legal/AgreementTick';
import { agreementProblem, versionForTick } from '@/lib/agreements';
import { isProviderEnabled } from '@/lib/authProviders';
import { supabaseEmailFlow } from '@/lib/supabaseEmailFlow';
import { CODE_MAX_LENGTH, looksLikeEmail, needsName, tidyCode, tidyEmail } from '@/lib/emailCodeSignIn';
import { CodeTarget, sendSignInCode, verifySignInCode } from '@/lib/signInCode';
import { displayPhone, maskIdentifier, parseIdentifier } from '@/lib/signInIdentifier';
import {
    clearPending,
    forgetAccount,
    readPending,
    readRemembered,
    recordCodeSent,
    rememberAccount,
    RememberedAccount,
    RESEND_SECONDS,
    savePending,
    secondsUntilResend,
} from '@/lib/signInMemory';
import { recordStayChoice, signOutThisDevice } from '@/lib/staySignedIn';
import { getImageUrl } from '@/lib/utils';

/**
 * Log in or sign up — the one way into a guest account, modelled screen for
 * screen on Airbnb's panel (looked at 02/10/2026: one "Log in or sign up" item
 * in the account menu, one panel, one "Phone number or email" field, Continue,
 * a small Google icon under an "or", then "Confirm it's you" with a six-digit
 * code). Our goose and our emerald, never their pink.
 *
 *   welcome — someone who signed out on this device: photo, first name, the
 *             address masked, one Log in button and "Not you?".
 *   start   — "Phone number or email", Continue. The same next screen follows
 *             whether or not the address has an account, so the panel never
 *             reveals who is on the site.
 *   code    — the six digits, emailed or texted depending on what was typed.
 *   details — new accounts only (an account with no name): their name, and an
 *             email address when they signed up with a phone number, so booking
 *             confirmations have somewhere to go.
 *   terms   — new accounts only: the Guest Terms, the last screen of sign-up.
 *
 * A returning person goes straight from the code to wherever they were.
 *
 * There is no password here and never will be for a new account: the code is
 * the proof. Mounted once, in the root layout (AuthPanelHost); every "Log in"
 * button on the site opens it with openAuthPanel().
 */

export const OPEN_AUTH_PANEL = 'gg:open-auth-panel';

// Open the panel from anywhere. `next` is where to go once signed in; without
// it the page reloads in place (which keeps a listing's dates — they live in
// its URL, see lib/bookingDraftParams).
export function openAuthPanel(next?: string | null) {
    window.dispatchEvent(new CustomEvent(OPEN_AUTH_PANEL, { detail: { next: next || null } }));
}

type Screen = 'welcome' | 'start' | 'code' | 'details' | 'terms';

const INPUT = 'w-full rounded-xl border border-slate-400 px-4 py-3.5 text-base text-slate-900 placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900';
const PRIMARY = 'w-full rounded-xl bg-emerald-700 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400';
const LINK = 'font-semibold text-slate-900 underline underline-offset-2 hover:text-emerald-800 disabled:opacity-60';

export default function AuthPanelHost() {
    const supabase = createClientComponentClient();
    const [mounted, setMounted] = useState(false);
    const [open, setOpen] = useState(false);
    const [next, setNext] = useState<string | null>(null);
    const [screen, setScreen] = useState<Screen>('start');
    const [remembered, setRemembered] = useState<RememberedAccount | null>(null);
    const [phoneOn, setPhoneOn] = useState(false);
    const [field, setField] = useState('');
    const [target, setTarget] = useState<CodeTarget | null>(null);
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [needEmail, setNeedEmail] = useState(false);
    const [session, setSession] = useState<any>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [wait, setWait] = useState(0);
    const [ticked, setTicked] = useState(false);
    const [termsError, setTermsError] = useState('');
    // "Stay signed in on this device" — on by default (lib/staySignedIn).
    const [stay, setStay] = useState(true);
    const firstField = useRef<HTMLInputElement>(null);

    useEffect(() => { setMounted(true); }, []);

    // Text codes are offered only where Supabase says phone sign-in is on.
    useEffect(() => {
        let live = true;
        isProviderEnabled('phone').then((on) => { if (live) setPhoneOn(on); });
        return () => { live = false; };
    }, []);

    const go = (s: Screen) => {
        setError('');
        setNotice('');
        setScreen(s);
    };

    const reset = useCallback(() => {
        const r = readRemembered();
        setRemembered(r);
        setField('');
        setCode('');
        setName('');
        setEmail('');
        setTarget(null);
        setTicked(false);
        setTermsError('');
        setError('');
        setNotice('');
        setScreen(r ? 'welcome' : 'start');
    }, []);

    // Opened by any Log in button on the page.
    useEffect(() => {
        const onOpen = (e: Event) => {
            const detail = (e as CustomEvent).detail || {};
            setNext(detail.next || null);
            reset();
            setOpen(true);
        };
        window.addEventListener(OPEN_AUTH_PANEL, onOpen);
        return () => window.removeEventListener(OPEN_AUTH_PANEL, onOpen);
    }, [reset]);

    // A code was on its way when this tab last showed the panel — a phone
    // browser throwing the tab away while its owner fetched the code. Reopen on
    // "Confirm it's you" rather than strand it. Only when nobody is signed in.
    useEffect(() => {
        const p = readPending();
        if (!p) return;
        supabase.auth.getSession().then(({ data }) => {
            if (data.session) { clearPending(); return; }
            setTarget({ kind: p.kind, value: p.value });
            setWait(secondsUntilResend(p.value));
            setNext(p.next || null);
            setRemembered(readRemembered());
            setScreen('code');
            setOpen(true);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keep the site-wide terms prompt out of the way while the panel is up.
    useEffect(() => (open ? holdAgreementGate() : undefined), [open]);

    // Put the cursor in the first field when the panel opens — but only on a
    // mouse. On a touch phone this focus is what still zoomed the panel in and
    // pushed its top off the screen even after #254 made every input 16px: the
    // trigger was never the font size (the field is a genuine 16px), it was
    // forcing focus as the bottom sheet mounts, which brings up the keyboard and
    // makes iOS Safari zoom and scroll to the caret. The guest taps the field
    // themselves on a phone — as Airbnb's own panel leaves them to — so there is
    // no forced focus to zoom against; the convenience stays on the desktop
    // dialog, where there is no soft keyboard.
    useEffect(() => {
        if (!open) return;
        if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return;
        firstField.current?.focus();
    }, [open, screen]);

    useEffect(() => {
        if (wait <= 0) return;
        const t = setTimeout(() => setWait(wait - 1), 1000);
        return () => clearTimeout(t);
    }, [wait]);

    const close = () => {
        clearPending();
        setOpen(false);
    };

    // Where the email's link (for anyone who taps it instead of typing the code)
    // returns to: this page, dates and all — or the explicit `next`.
    const returnLink = () => {
        const here = next || (window.location.pathname + window.location.search);
        return `${window.location.origin}/auth/callback?next=${encodeURIComponent(here)}`;
    };

    // 'sent' — a new code is on its way. 'already' — one went to this address
    // under a minute ago and still works, so we go to the code screen with the
    // seconds left on the resend button instead of failing with "wait a
    // minute". The same either way the person arrived (Log in, or Not you?).
    const send = async (t: CodeTarget): Promise<'sent' | 'already' | false> => {
        setError('');
        setNotice('');
        const left = secondsUntilResend(t.value);
        if (left > 0) {
            savePending({ kind: t.kind, value: t.value, at: Date.now(), next });
            setCode('');
            setWait(left);
            return 'already';
        }
        setBusy(true);
        // Email goes through the email-flow client so the link in the email works
        // on whichever device it is opened (lib/supabaseEmailFlow); the code
        // itself works from either.
        const r = await sendSignInCode(t.kind === 'email' ? supabaseEmailFlow() : supabase, t, t.kind === 'email' ? returnLink() : undefined);
        setBusy(false);
        if (!r.ok) {
            // Supabase's own cooldown (a code sent from another tab, say): the
            // code it refers to is still good, so treat it exactly as above.
            if (r.retryAfter > 0) {
                recordCodeSent(t.value, Date.now() - (RESEND_SECONDS - r.retryAfter) * 1000);
                savePending({ kind: t.kind, value: t.value, at: Date.now(), next });
                setCode('');
                setWait(r.retryAfter);
                return 'already';
            }
            setError(r.message);
            return false;
        }
        recordCodeSent(t.value);
        savePending({ kind: t.kind, value: t.value, at: Date.now(), next });
        setCode('');
        setWait(RESEND_SECONDS);
        return 'sent';
    };

    const alreadySent = 'We sent you a code less than a minute ago, and it still works. Enter it below, or send a new one when the timer runs out.';

    const sendAndShowCode = async (t: CodeTarget) => {
        const r = await send(t);
        if (!r) return;
        go('code');
        if (r === 'already') setNotice(alreadySent);
    };

    const submitStart = async (e?: FormEvent) => {
        e?.preventDefault();
        const id = parseIdentifier(field);
        if (id.kind === 'invalid') { setError(id.message); return; }
        if (id.kind === 'phone' && !phoneOn) {
            setError('We can’t text codes just yet. Use your email address instead.');
            return;
        }
        const t: CodeTarget = { kind: id.kind, value: id.value };
        setTarget(t);
        await sendAndShowCode(t);
    };

    const logInRemembered = async () => {
        if (!remembered) return;
        if (remembered.kind === 'phone' && !phoneOn) {
            setError('We can’t text codes just yet. Use another account to log in with your email.');
            return;
        }
        const t: CodeTarget = { kind: remembered.kind, value: remembered.value };
        setTarget(t);
        await sendAndShowCode(t);
    };

    const notYou = () => {
        forgetAccount();
        setRemembered(null);
        go('start');
    };

    const resend = async () => {
        if (!target) return;
        const r = await send(target);
        if (r === 'sent') setNotice('New code sent. Use the latest one — earlier codes stop working.');
        if (r === 'already') setNotice(alreadySent);
    };

    // Signed in. Where to now?
    const finish = async (s: any) => {
        clearPending();
        if (next) { window.location.href = next; return; }
        // A tradesman or experience provider signing in is not looking for a
        // cottage: land an approved provider on their dashboard, as before.
        try {
            const { data: provider } = await supabase
                .from('service_providers')
                .select('id')
                .eq('owner_id', s.user.id)
                .eq('status', 'approved')
                .limit(1)
                .maybeSingle();
            if (provider) { window.location.href = '/services/dashboard'; return; }
        } catch {
            // Never let the provider check block a sign-in.
        }
        window.location.reload();
    };

    const remember = (s: any, fullName: string | null | undefined, avatar: string | null | undefined) => {
        // A shared computer ("don't stay signed in") is not told who you are.
        if (!stay) { forgetAccount(); return; }
        const first = String(fullName || '').trim().split(/\s+/)[0] || '';
        const u = s.user || {};
        const kind: 'email' | 'phone' = u.email ? 'email' : 'phone';
        const value = u.email ? tidyEmail(u.email) : u.phone ? '+' + String(u.phone).replace(/^\+/, '') : '';
        if (first && value) rememberAccount({ firstName: first, avatarUrl: avatar ? getImageUrl(avatar) : null, kind, value });
    };

    const submitCode = async (e?: FormEvent) => {
        e?.preventDefault();
        if (!target || busy) return;
        setBusy(true);
        setError('');
        const r = await verifySignInCode(supabase, target, code);
        if (!r.ok) {
            setBusy(false);
            setError(r.message);
            return;
        }
        clearPending();
        // The lifetime the middleware gives the sign-in cookie from the next page.
        recordStayChoice(stay);
        if (!stay) forgetAccount();
        const s = r.value;
        setSession(s);
        const { data: prof } = await supabase.from('profiles').select('full_name, avatar_url').eq('id', s.user.id).maybeSingle();
        if (needsName(prof?.full_name)) {
            // New: name (and an email if they came by phone), then the terms.
            setNeedEmail(!s.user.email);
            setBusy(false);
            go('details');
            return;
        }
        remember(s, prof?.full_name, prof?.avatar_url);
        await finish(s);
    };

    const submitDetails = async (e?: FormEvent) => {
        e?.preventDefault();
        const full = name.trim();
        if (!full) { setError('Enter your name.'); return; }
        if (needEmail && !looksLikeEmail(email)) { setError('Enter your email address — we send booking confirmations there.'); return; }
        setBusy(true);
        setError('');
        const { error: err } = await supabase.from('profiles').update({ full_name: full }).eq('id', session.user.id);
        if (err) {
            setBusy(false);
            setError('We couldn’t save your name. Check your connection and try again.');
            return;
        }
        // Mirrored onto the auth user, where the rest of the page reads a
        // greeting name from before the profile is loaded.
        const update: Record<string, unknown> = { data: { name: full } };
        if (needEmail) update.email = tidyEmail(email);
        const { error: upErr } = await supabase.auth.updateUser(update as any, needEmail ? { emailRedirectTo: returnLink() } : undefined);
        if (upErr && needEmail) {
            setBusy(false);
            setError(/already|registered|exists/i.test(upErr.message || '')
                ? 'That email is already on an account. Log in with it instead, or use a different one.'
                : 'We couldn’t save your email. Check it and try again.');
            return;
        }
        remember(session, full, null);
        const st = await fetchAgreementStatus();
        // Fail closed: skip the terms only on a positive confirmation.
        if (st && st.documents && st.documents.guest && st.documents.guest.agreed) { await finish(session); return; }
        setBusy(false);
        go('terms');
    };

    const submitTerms = async (e?: FormEvent) => {
        e?.preventDefault();
        const problem = agreementProblem('guest', null, versionForTick('guest', ticked));
        if (problem) { setTermsError(problem); return; }
        setBusy(true);
        setTermsError('');
        const failed = await recordAgreement('guest', 'signup');
        if (failed) { setBusy(false); setTermsError(failed); return; }
        await finish(session);
    };

    // The way out for someone who will not agree: signed out, panel closed.
    const leaveWithoutAgreeing = async () => {
        await signOutThisDevice(supabase);
        window.location.reload();
    };

    if (!mounted || !open) return null;

    // Instagram's "save login info", worded for us. Ticked by default; untick on
    // a shared or borrowed computer.
    const stayTick = (
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
            <input
                type="checkbox"
                checked={stay}
                onChange={(e) => setStay(e.target.checked)}
                className="h-4 w-4 rounded border-slate-400 accent-emerald-700"
            />
            Stay signed in on this device
        </label>
    );

    const signedIn = screen === 'details' || screen === 'terms';
    const heading =
        screen === 'welcome' ? `Welcome back, ${remembered?.firstName || ''}`
            : screen === 'start' ? 'Log in or sign up'
                : screen === 'code' ? 'Confirm it’s you'
                    : screen === 'details' ? 'Finish signing up'
                        : 'Our Guest Terms';

    // Masked when the code went to the remembered account: whoever pressed Log
    // in on the welcome screen has not shown they know the full address yet.
    const fromMemory = !!(target && remembered && remembered.value === target.value);
    const sentTo = !target ? ''
        : fromMemory ? maskIdentifier(target)
            : target.kind === 'phone' ? displayPhone(target.value) : target.value;

    return createPortal(
        // Portalled to <body>: the account menu that opens this is a Radix
        // popover positioned with a transform, which would otherwise become the
        // containing block for `fixed` and squeeze the panel into the dropdown.
        <div
            className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center sm:px-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-panel-heading"
        >
            <div className="relative max-h-[100dvh] w-full overflow-y-auto rounded-t-3xl bg-white px-6 pb-8 pt-6 shadow-2xl sm:max-w-[480px] sm:rounded-3xl sm:px-8">
                <div className="flex h-8 items-center justify-between">
                    {screen === 'code' ? (
                        <button
                            type="button"
                            onClick={() => { clearPending(); go(remembered && target && remembered.value === target.value ? 'welcome' : 'start'); }}
                            aria-label="Back"
                            className="-ml-2 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
                        >
                            <ArrowLeft className="h-5 w-5" />
                        </button>
                    ) : <span />}
                    {!signedIn && (
                        <button
                            type="button"
                            onClick={close}
                            aria-label="Close"
                            className="-mr-2 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    )}
                </div>

                {screen !== 'welcome' && (
                    <GooseMark className="mx-auto mb-3 h-auto w-12 text-emerald-700" />
                )}

                {screen === 'welcome' && remembered && (
                    <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-slate-900 text-3xl font-semibold text-white">
                        {remembered.avatarUrl
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={remembered.avatarUrl} alt="" className="h-full w-full object-cover" />
                            : remembered.firstName.charAt(0).toUpperCase()}
                    </div>
                )}

                <h2 id="auth-panel-heading" className="text-center text-2xl font-semibold tracking-tight text-slate-900">
                    {heading}
                </h2>

                {screen === 'welcome' && remembered && (
                    <div className="mt-2">
                        <p className="text-center text-slate-600">{maskIdentifier(remembered)}</p>
                        <div className="mt-8 space-y-4">
                            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                            <button type="button" onClick={logInRemembered} disabled={busy} className={PRIMARY}>
                                {busy ? 'Sending your code…' : 'Log in'}
                            </button>
                            {stayTick}
                        </div>
                        <p className="mt-6 text-center text-sm text-slate-600">
                            Not you?{' '}
                            <button type="button" onClick={notYou} className={LINK}>Use another account</button>
                        </p>
                    </div>
                )}

                {screen === 'start' && (
                    <>
                        <form onSubmit={submitStart} className="mt-6 space-y-4" noValidate>
                            <div>
                                <label htmlFor="auth-id" className="sr-only">{phoneOn ? 'Phone number or email' : 'Email'}</label>
                                <input
                                    ref={firstField}
                                    id="auth-id"
                                    type={phoneOn ? 'text' : 'email'}
                                    inputMode={phoneOn ? 'text' : 'email'}
                                    autoComplete={phoneOn ? 'username' : 'email'}
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    value={field}
                                    onChange={(e) => { setField(e.target.value); setError(''); }}
                                    placeholder={phoneOn ? 'Phone number or email' : 'Email'}
                                    className={INPUT}
                                />
                            </div>
                            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                            <button type="submit" disabled={busy} className={PRIMARY}>
                                {busy ? 'Sending your code…' : 'Continue'}
                            </button>
                            {stayTick}
                        </form>
                        <GoogleButton
                            compact
                            onStart={() => { recordStayChoice(stay); if (!stay) forgetAccount(); }}
                            divider={
                                <div className="my-6 flex items-center gap-3 text-xs text-slate-500">
                                    <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
                                </div>
                            }
                        />
                    </>
                )}

                {screen === 'code' && target && (
                    <>
                        <p className="mt-2 text-center text-slate-600 [text-wrap:pretty]">
                            {target.kind === 'phone' ? 'We texted a code to ' : 'We sent a code to '}
                            <span className="break-all">{sentTo}</span>.
                        </p>
                        <form onSubmit={submitCode} className="mt-6 space-y-4" noValidate>
                            <label htmlFor="auth-code" className="sr-only">Code</label>
                            <input
                                ref={firstField}
                                id="auth-code"
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={CODE_MAX_LENGTH + 4}
                                value={code}
                                onChange={(e) => { setCode(tidyCode(e.target.value)); setError(''); }}
                                placeholder="– – – – – –"
                                // INPUT's text-base swapped out, not added to: with both
                                // classes on, .text-base comes later in the built CSS
                                // and won, so this box was really 16px — right on the
                                // line where iOS Safari zooms on focus.
                                className={INPUT.replace('text-base', 'text-2xl') + ' mx-auto block max-w-[240px] text-center tracking-[0.4em]'}
                            />
                            {error && <p role="alert" className="text-center text-sm text-red-600">{error}</p>}
                            {notice && <p className="text-center text-sm text-emerald-800">{notice}</p>}
                            {/* A button rather than checking at the sixth digit: the
                                code length is a Supabase project setting (six to
                                ten), so the panel cannot know when one is whole. */}
                            <button type="submit" disabled={busy || code.length < 6} className={PRIMARY}>
                                {busy ? 'Checking…' : 'Continue'}
                            </button>
                        </form>
                        <p className="mt-6 text-center text-sm text-slate-600">
                            Didn’t get it?{' '}
                            <button type="button" onClick={resend} disabled={busy || wait > 0} className={LINK}>
                                {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
                            </button>
                        </p>
                        {target.kind === 'email' && (
                            <p className="mt-2 text-center text-xs text-slate-500">Check your spam folder if it isn’t in your inbox.</p>
                        )}
                    </>
                )}

                {screen === 'details' && (
                    <>
                        <p className="mt-2 text-center text-slate-600 [text-wrap:pretty]">
                            This is the name hosts will see on your bookings.
                        </p>
                        <form onSubmit={submitDetails} className="mt-6 space-y-4" noValidate>
                            <div>
                                <label htmlFor="auth-name" className="mb-1.5 block text-xs font-medium text-slate-600">Full name</label>
                                <input
                                    ref={firstField}
                                    id="auth-name"
                                    type="text"
                                    autoComplete="name"
                                    value={name}
                                    onChange={(e) => { setName(e.target.value); setError(''); }}
                                    className={INPUT}
                                />
                            </div>
                            {needEmail && (
                                <div>
                                    <label htmlFor="auth-email" className="mb-1.5 block text-xs font-medium text-slate-600">Email</label>
                                    <input
                                        id="auth-email"
                                        type="email"
                                        inputMode="email"
                                        autoComplete="email"
                                        value={email}
                                        onChange={(e) => { setEmail(e.target.value); setError(''); }}
                                        className={INPUT}
                                    />
                                    <p className="mt-1.5 text-xs text-slate-500">We’ll send booking confirmations and receipts here.</p>
                                </div>
                            )}
                            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                            <button type="submit" disabled={busy || !name.trim() || (needEmail && !email.trim())} className={PRIMARY}>
                                {busy ? 'Saving…' : 'Continue'}
                            </button>
                        </form>
                    </>
                )}

                {screen === 'terms' && (
                    <>
                        <p className="mt-2 text-center text-slate-600 [text-wrap:pretty]">
                            Before you carry on, please read and agree to our Guest Terms. They cover your account, bookings and how the site works.
                        </p>
                        <form onSubmit={submitTerms} className="mt-6 space-y-5" noValidate>
                            <AgreementTick
                                doc="guest"
                                id="auth-agree-guest"
                                open="tab"
                                checked={ticked}
                                onChange={(v) => { setTicked(v); setTermsError(''); }}
                                error={termsError}
                            />
                            <button type="submit" disabled={busy || !ticked} className={PRIMARY}>
                                {busy ? 'Saving…' : 'Agree and continue'}
                            </button>
                        </form>
                        <p className="mt-6 text-center text-sm text-slate-600">
                            <button type="button" onClick={leaveWithoutAgreeing} className={LINK}>Not now — log out</button>
                        </p>
                    </>
                )}
            </div>
        </div>,
        document.body
    );
}
