'use client';

import React, { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import GoogleButton from './GoogleButton';

const LoginModel = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [sendingReset, setSendingReset] = useState(false);
    const supabase = createClientComponentClient();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) {
            setError(error.message);
        } else {
            window.location.reload();
        }
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
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
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
            <li 
                onClick={() => setIsOpen(true)}
                className="hover:bg-slate-200 rounded-md p-2 cursor-pointer list-none"
            >
                Log In
            </li>

            {isOpen && (
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
            )}
        </>
    );
};

export default LoginModel;
