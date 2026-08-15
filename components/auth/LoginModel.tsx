'use client';

import React, { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

const LoginModel = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
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

    const handleSocialLogin = async (provider: 'google' | 'facebook') => {
        await supabase.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });
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
                        </form>

                        <div className="relative my-4">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-white px-2 text-slate-500">-- or --</span>
                            </div>
                        </div>

                        <div className="flex flex-col space-y-3">
                            <button
                                onClick={() => handleSocialLogin('google')}
                                className="w-full py-3 px-4 border rounded-xl font-medium text-slate-700 hover:bg-slate-50 transition flex items-center justify-center space-x-2"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 24 24">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                                </svg>
                                <span>Continue with Google</span>
                            </button>
                            <button
                                onClick={() => handleSocialLogin('facebook')}
                                className="w-full py-3 px-4 border rounded-xl font-medium text-slate-700 hover:bg-slate-50 transition flex items-center justify-center space-x-2"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 24 24">
                                    <path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/>
                                </svg>
                                <span>Continue with Facebook</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default LoginModel;
