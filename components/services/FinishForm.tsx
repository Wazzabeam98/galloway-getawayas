'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import EmailFirstStep from '@/components/auth/EmailFirstStep';

// One field. Everything else was typed on the wizard and is already saved.
export default function FinishForm({ token, email, trade }: { token: string; email: string; trade?: string }) {
    const [password, setPassword] = useState('');
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const supabase = createClientComponentClient();
    // Signed in as this very address. Every sign-up now opens on the
    // email-code step, so somebody still holding an old link may well have an
    // account by now; the route attaches the application to it (no password).
    const [ownsAddress, setOwnsAddress] = useState(false);
    // The route said the address has an account and they are not signed in to
    // it: sign them in with a code, then send the link again.
    const [needsSignIn, setNeedsSignIn] = useState(false);

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            const signedIn = data.session?.user?.email || '';
            setOwnsAddress(!!signedIn && signedIn.toLowerCase() === email.toLowerCase());
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const goToApplication = () => {
        // A full navigation rather than a router push: every signed-in
        // surface reads the session from cookies on the server.
        window.location.href = '/services/join?trade=' + encodeURIComponent(trade || '') + '&finished=1';
    };

    // Signed in as the address: no password, the route uses the session.
    const attach = async () => {
        setError('');
        setBusy(true);
        try {
            const res = await fetch('/api/services/finish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });
            const out = await res.json().catch(() => ({}));
            if (out && out.ok) {
                setDone(true);
                goToApplication();
                return;
            }
            setError((out && out.error) || 'We could not finish that. Try again in a moment.');
        } catch {
            setError('We could not reach the site. Check your connection and try again.');
        } finally {
            setBusy(false);
        }
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password.length < 8) {
            setError('Pick a password of at least 8 characters.');
            return;
        }

        setBusy(true);
        try {
            const res = await fetch('/api/services/finish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password }),
            });
            const out = await res.json().catch(() => ({}));

            if (out && out.ok) {
                setDone(true);

                // AND SIGN THEM IN, which is not a nicety.
                //
                // The account is created server-side with the admin API, which
                // hands back no session — so without this they set a password,
                // land back on /services/join as a stranger, and are shown the
                // empty wizard again with no sign that anything worked. That is
                // the same failure the one-press design was built to remove,
                // arriving one screen later.
                //
                // The browser already holds the password they just chose, so
                // this needs nothing from the server it does not have.
                const { error: signInError } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });

                if (signInError) {
                    // Their account and listing both exist; only the session
                    // did not happen. Say so and send them to sign in rather
                    // than dropping them somewhere that looks like failure.
                    setError('Your application is in. Sign in with ' + email + ' to see it.');
                    setBusy(false);
                    return;
                }

                goToApplication();
                return;
            }

            if (out && out.code === 'account_exists') {
                setNeedsSignIn(true);
                return;
            }

            setError((out && out.error) || 'We could not finish that. Try again in a moment.');
        } catch (err: any) {
            setError('We could not reach the site. Check your connection and try again.');
        } finally {
            setBusy(false);
        }
    };

    if (needsSignIn) {
        return (
            <EmailFirstStep
                eyebrow="Finish your application"
                intro="This address already has an account. Sign in and we’ll add your application to it."
                exitHref="/business"
                initialEmail={email}
                onSignedIn={(s) => {
                    setNeedsSignIn(false);
                    if ((s?.user?.email || '').toLowerCase() === email.toLowerCase()) {
                        setOwnsAddress(true);
                        attach();
                    } else {
                        setError('You signed in as ' + (s?.user?.email || 'another address') + '. This application was made from ' + email + ' — sign in with that address to add it.');
                    }
                }}
            />
        );
    }

    if (ownsAddress) {
        return (
            <div>
                <p className="text-sm text-slate-600">
                    You’re signed in as <strong className="text-slate-900">{email}</strong>. Add this application to your account to send it for review.
                </p>
                {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
                <button
                    type="button"
                    onClick={attach}
                    disabled={busy || done}
                    className="w-full mt-5 bg-emerald-700 text-white font-semibold rounded-xl py-3 hover:bg-emerald-800 transition disabled:opacity-60"
                >
                    {busy || done ? 'Sending…' : 'Add to my account and send to review'}
                </button>
            </div>
        );
    }

    return (
        <form onSubmit={submit}>
            <label htmlFor="finish-password" className="block text-sm font-semibold text-slate-900 mb-2">
                Password
            </label>
            <div className="relative">
                <input
                    id="finish-password"
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    className="w-full border border-slate-300 rounded-xl p-3 pr-16 text-sm"
                    required
                />
                <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-emerald-800"
                >
                    {show ? 'Hide' : 'Show'}
                </button>
            </div>

            <p className="text-sm text-slate-500 mt-2">
                At least 8 characters. You will sign in with{' '}
                <strong className="text-slate-900">{email}</strong>.
            </p>

            {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

            <button
                type="submit"
                disabled={busy || done}
                className="w-full mt-5 bg-emerald-700 text-white font-semibold rounded-xl py-3 hover:bg-emerald-800 transition disabled:opacity-60"
            >
                {busy || done ? 'Sending…' : 'Finish and send to review'}
            </button>
        </form>
    );
}
