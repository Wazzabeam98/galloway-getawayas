'use client';

// A combined sign-in / create-account panel, rendered inline on a page (not a
// modal). It exists because the host call-to-action ("Start hosting" → List a
// holiday let → /addhome) used to drop a brand-new host onto a login-only box
// with no way to sign up, where a fresh email returned the misleading "Invalid
// login credentials" (which reads as "wrong password"). This gives both flows on
// one screen with a clear switch, and never tells a new visitor their
// credentials are invalid when the real answer is "you don't have an account
// yet".
//
// The create-account flow mirrors components/auth/SignupModel exactly (same
// email-flow client, same emailRedirectTo, same confirm-your-email panel and the
// same profile UPDATE) so the two cannot drift.

import React, { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { supabaseEmailFlow } from '@/lib/supabaseEmailFlow';
import { MailCheck } from 'lucide-react';
import GoogleButton from './GoogleButton';

type Mode = 'signup' | 'login';

export default function AuthPanel({
    defaultMode = 'signup',
    next,
    heading = 'Create your account',
    subheading,
}: {
    defaultMode?: Mode;
    next?: string;
    heading?: string;
    subheading?: string;
}) {
    const supabase = createClientComponentClient();
    const [mode, setMode] = useState<Mode>(defaultMode);

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [sentTo, setSentTo] = useState('');
    const [resending, setResending] = useState(false);

    const clearMessages = () => { setError(''); setNotice(''); };
    const switchMode = (m: Mode) => { setMode(m); clearMessages(); };

    // Supabase's wording, turned into something a new host can act on. The key
    // one: "Invalid login credentials" is returned both for a wrong password AND
    // for an email with no account at all, so it must never be shown bare — it
    // reads as "wrong password" to someone who has never signed up.
    const explainLogin = (message: string): { text: string; offerSignup: boolean } => {
        if (/invalid login credentials/i.test(message)) {
            return {
                text: 'We couldn’t sign you in. Either the password is wrong, or there’s no account for that email yet.',
                offerSignup: true,
            };
        }
        if (/email not confirmed/i.test(message)) {
            return { text: 'Your email address hasn’t been confirmed yet — check your inbox for the link we sent when you signed up.', offerSignup: false };
        }
        return { text: message || 'Something went wrong signing you in. Please try again.', offerSignup: false };
    };

    const explainSignup = (err: any): string => {
        const message: string = (err && err.message) || '';
        const status: number = (err && err.status) || 0;
        if (status === 429 || /rate limit/i.test(message)) {
            return 'We could not send your confirmation email just now — too many have gone out from the site in the last hour. Nothing is wrong with your details. Please try again a little later.';
        }
        if (/password/i.test(message)) return message;
        if (!message) return 'Something went wrong reaching the server, so your account was not created. Please check your connection and try again.';
        return message;
    };

    const afterAuthedRedirect = () => {
        if (next) { window.location.href = next; return; }
        window.location.reload();
    };

    const doLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        clearMessages();
        setBusy(true);
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        setBusy(false);
        if (signInError) {
            const { text, offerSignup } = explainLogin(signInError.message || '');
            setError(text);
            if (offerSignup) {
                // Pre-fill and switch focus toward creating an account, but leave
                // it to the visitor to press — they might just have fat-fingered
                // their password.
                setNotice('New to Galloway Getaways? Create an account below — it takes a moment.');
            }
            return;
        }
        afterAuthedRedirect();
    };

    const doSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        clearMessages();
        if (!name.trim()) { setError('Please enter your name.'); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Please enter a valid email address.'); return; }
        if (password.length < 8) { setError('Choose a password of at least 8 characters.'); return; }
        if (password !== confirm) { setError('The two passwords don’t match.'); return; }

        setBusy(true);
        try {
            const { data, error: signUpError } = await supabaseEmailFlow().auth.signUp({
                email: email.trim(),
                password,
                options: {
                    data: { name: name.trim() },
                    emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
                },
            });
            if (signUpError) {
                setBusy(false);
                // Never reveal whether an email is already registered — that turns
                // sign-up into an account-enumeration oracle. If Supabase reports
                // the address is taken, answer EXACTLY as a fresh sign-up would:
                // show "check your inbox". Supabase (with signup email confirmation
                // on) sends the existing owner a "you already have an account"
                // notice, so a real owner is still helped without a stranger being
                // able to tell the address exists. (See the note about the
                // dashboard's enumeration-protection setting.)
                if (/already registered|already been registered|already exists/i.test(signUpError.message || '')) {
                    setSentTo(email.trim());
                    return;
                }
                setError(explainSignup(signUpError));
                return;
            }

            // Email confirmation OFF → a session comes back straight away.
            if (data.session) {
                await supabase.auth.setSession(data.session);
                // The add_profile_for_new_user trigger already made the row; only
                // the name needs writing (email/is_host belong to the trigger).
                await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', data.session.user.id);
                setBusy(false);
                afterAuthedRedirect();
                return;
            }
            // Email confirmation ON → link is on its way.
            setBusy(false);
            setSentTo(email.trim());
        } catch (err: any) {
            setBusy(false);
            setError(explainSignup(err));
        }
    };

    const forgot = async () => {
        clearMessages();
        if (!email.trim()) { setError('Type your email address first, then choose this again.'); return; }
        setBusy(true);
        const { error: resetError } = await supabaseEmailFlow().auth.resetPasswordForEmail(email.trim(), {
            redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset`,
        });
        setBusy(false);
        if (resetError) { setError(resetError.message); return; }
        setNotice('If that address has an account, a link is on its way. It lasts an hour.');
    };

    const resend = async () => {
        if (!sentTo) return;
        setResending(true);
        const { error: resendError } = await supabaseEmailFlow().auth.resend({
            type: 'signup',
            email: sentTo,
            options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname + window.location.search)}` },
        });
        setResending(false);
        if (resendError) { setError(explainSignup(resendError)); return; }
        setNotice('Confirmation email sent again.');
    };

    const field = 'w-full p-3 border rounded-xl text-sm';

    if (sentTo) {
        return (
            <div className="w-full max-w-[425px] rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_6px_16px_rgba(0,0,0,0.12)] text-center">
                <div className="flex justify-center mb-4">
                    <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
                        <MailCheck className="w-7 h-7 text-emerald-700" />
                    </div>
                </div>
                <h2 className="text-lg font-bold text-slate-900">Check your inbox</h2>
                <p className="text-sm text-slate-600 mt-2">
                    We’ve sent a confirmation link to <span className="font-semibold text-slate-900">{sentTo}</span>.
                    Click it to activate your account, and you’ll come straight back here to finish.
                </p>
                {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
                {notice && <p className="mt-3 text-sm text-emerald-700">{notice}</p>}
                <div className="mt-5 flex flex-col space-y-2">
                    <button type="button" onClick={resend} disabled={resending}
                        className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition disabled:opacity-50">
                        {resending ? 'Sending…' : 'Resend confirmation email'}
                    </button>
                    <button type="button" onClick={() => { setSentTo(''); setMode('login'); }}
                        className="w-full text-sm text-slate-500 hover:text-slate-800 py-2">
                        Back to sign in
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-[425px] rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_6px_16px_rgba(0,0,0,0.12)] text-left">
            {/* The switch — a segmented control so both options are visible at once. */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 mb-5" role="tablist">
                <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => switchMode('signup')}
                    className={'py-2 rounded-lg text-sm font-semibold transition ' + (mode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
                    Create account
                </button>
                <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => switchMode('login')}
                    className={'py-2 rounded-lg text-sm font-semibold transition ' + (mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
                    Log in
                </button>
            </div>

            <div className="text-center mb-4">
                <h2 className="text-xl font-bold text-slate-900">{mode === 'signup' ? heading : 'Welcome back'}</h2>
                {subheading && mode === 'signup' && <p className="text-sm text-slate-600 mt-1">{subheading}</p>}
            </div>

            {error && <p className="text-red-600 text-sm text-center mb-3">{error}</p>}
            {notice && <p className="text-emerald-700 text-sm text-center mb-3">{notice}</p>}

            {mode === 'signup' ? (
                <form onSubmit={doSignup} className="space-y-3">
                    <input type="text" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className={field} autoComplete="name" required />
                    <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} autoComplete="email" required />
                    <input type="password" placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} className={field} autoComplete="new-password" required />
                    <input type="password" placeholder="Repeat password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} autoComplete="new-password" required />
                    <button type="submit" disabled={busy} className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition disabled:opacity-50">
                        {busy ? 'Creating your account…' : 'Create account'}
                    </button>
                    <p className="text-center text-sm text-slate-600">
                        Already have an account?{' '}
                        <button type="button" onClick={() => switchMode('login')} className="font-semibold text-emerald-700 underline">Log in</button>
                    </p>
                </form>
            ) : (
                <form onSubmit={doLogin} className="space-y-3">
                    <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} autoComplete="email" required />
                    <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} autoComplete="current-password" required />
                    <button type="submit" disabled={busy} className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition disabled:opacity-50">
                        {busy ? 'Signing you in…' : 'Log in'}
                    </button>
                    <button type="button" onClick={forgot} disabled={busy} className="w-full text-xs font-semibold text-slate-500 underline hover:text-slate-800 disabled:opacity-50">
                        Forgotten your password?
                    </button>
                    <p className="text-center text-sm text-slate-600">
                        New to Galloway Getaways?{' '}
                        <button type="button" onClick={() => switchMode('signup')} className="font-semibold text-emerald-700 underline">Create an account</button>
                    </p>
                </form>
            )}

            <GoogleButton
                divider={
                    <div className="relative my-4">
                        <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                        <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-500">-- or --</span></div>
                    </div>
                }
            />
        </div>
    );
}
