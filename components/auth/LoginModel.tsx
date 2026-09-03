'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { supabaseEmailFlow } from '@/lib/supabaseEmailFlow';
import GoogleButton from './GoogleButton';

const LoginModel = ({ next }: { next?: string } = {}) => {
    const [isOpen, setIsOpen] = useState(false);
    // The overlay is rendered into document.body rather than where this
    // component sits. See the comment above the portal below.
    const [mounted, setMounted] = useState(false);
    useEffect(function () { setMounted(true); }, []);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [sendingReset, setSendingReset] = useState(false);
    const supabase = createClientComponentClient();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        const { data: signIn, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) {
            setError(error.message);
            return;
        }

        // An explicit return path wins over every default landing. Someone who
        // signed in FROM a trip invite must come back to it — even if their
        // account also runs an approved service business, which would otherwise
        // send them to the dashboard and strand the invite.
        if (next) {
            window.location.href = next;
            return;
        }

        // A tradesman signing in is not looking for a cottage. If this account
        // runs an approved service business, land them on their dashboard
        // rather than the guest homepage. RLS lets an owner read their own
        // provider row, so this is a single scoped query. Anyone else falls
        // through to the ordinary reload.
        try {
            const uid = signIn?.user?.id;
            if (uid) {
                const { data: provider } = await supabase
                    .from('service_providers')
                    .select('id')
                    .eq('owner_id', uid)
                    .eq('status', 'approved')
                    .limit(1)
                    .maybeSingle();
                if (provider) {
                    window.location.href = '/services/dashboard';
                    return;
                }
            }
        } catch {
            // Never let the provider check block a successful sign-in.
        }
        window.location.reload();
    };

    // Sends the reset email. The link goes through /auth/callback, which
    // swaps it for a session and then forwards to the form that actually
    // changes the password.
    const handleForgotPassword = async () => {
        setError('');
        setNotice('');

        if (!email.trim()) {
            setError('Type your email address first, then choose this again.');
            return;
        }

        setSendingReset(true);
        // Email-flow client: a reset link is read wherever the person keeps
        // their email, which is rarely the browser that asked for it.
        const { error: resetError } = await supabaseEmailFlow().auth.resetPasswordForEmail(email.trim(), {
            redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset`,
        });
        setSendingReset(false);

        // Said the same way whether or not the address is on an account. The
        // log in box should not be a way of finding out who has one.
        if (resetError) {
            setError(resetError.message);
            return;
        }
        setNotice('If that address has an account, a link is on its way. It lasts an hour.');
    };

    return (
        <>
            {/* A button rather than a clickable <li>: this and Sign Up were the
                only two items in the account menu that were not links, so they
                were the two a keyboard could not reach — which meant nobody
                using one could sign in at all. */}
            <li className="list-none">
                <button
                    type="button"
                    onClick={() => setIsOpen(true)}
                    className="w-full text-left hover:bg-slate-200 rounded-md p-2 cursor-pointer"
                >
                    Log In
                </button>
            </li>

            {isOpen && mounted && createPortal((
                // WHY THIS IS A PORTAL AND NOT JUST A FIXED DIV.
                //
                // A CSS transform on an ancestor makes that ancestor the
                // containing block for `position: fixed` descendants — so
                // `fixed inset-0` stops meaning "the viewport" and starts
                // meaning "that box".
                //
                // One of the eleven places this component is used is inside
                // the account menu in the navbar, which is a Radix popover:
                // Radix positions it with `transform: translate(x, y)`. So
                // choosing "Log In" from the menu built the overlay inside a
                // 288px dropdown instead of the screen. Measured on 31 August
                // 2026, at both widths: the panel came out 280px wide with its
                // top at -70px, so the "Log In" heading and "Welcome to
                // Galloway Getaways" were above the top of the window. It is
                // the first thing a returning host or guest ever clicks.
                //
                // Portalling to document.body puts it outside every transform
                // there is, which is also why the Sign Up modal was fine — it
                // is built on the Radix dialog, and that portals already.
                //
                // The other ten uses render this at page level where nothing
                // transforms them, and are unaffected either way.
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
                    <div className="bg-white rounded-2xl max-w-[425px] w-full p-6 relative shadow-lg">
                        <button 
                            onClick={() => setIsOpen(false)}
                            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 font-bold text-xl"
                        >
                            &times;
                        </button>

                        <div className="text-center mb-6">
                            <h2 className="text-xl font-bold text-slate-900">Log In</h2>
                            <p className="text-sm text-slate-600 mt-1">Welcome to Galloway Getaways</p>
                        </div>

                        <form onSubmit={handleLogin} className="space-y-4">
                            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                            {notice && <p className="text-emerald-700 text-sm text-center">{notice}</p>}
                            <div>
                                <input
                                    type="email"
                                    placeholder="Enter your e-mail"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full p-3 border rounded-xl text-sm"
                                    required
                                />
                            </div>
                            <div>
                                <input
                                    type="password"
                                    placeholder="Enter strong password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full p-3 border rounded-xl text-sm"
                                    required
                                />
                            </div>
                            <button type="submit" className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition">
                                Continue
                            </button>

                            <button
                                type="button"
                                onClick={handleForgotPassword}
                                disabled={sendingReset}
                                className="w-full text-xs font-semibold text-slate-500 underline hover:text-slate-800 disabled:opacity-50"
                            >
                                {sendingReset ? 'Sending…' : 'Forgotten your password?'}
                            </button>
                        </form>

                        <GoogleButton
                            divider={
                                <div className="relative my-4">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t" />
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-white px-2 text-slate-500">-- or --</span>
                                    </div>
                                </div>
                            }
                        />
                    </div>
                </div>
            ), document.body)}
        </>
    );
};

export default LoginModel;
