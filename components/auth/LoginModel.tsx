'use client';

import React, { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { Button } from '../ui/button';
import { FcGoogle } from 'react-icons/fc';
import { AiFillApple } from 'react-icons/ai';

const LoginModel = () => {
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

    const handleSocialLogin = async (provider: 'google' | 'apple') => {
        await supabase.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });
    };

    return (
        <Dialog>
            <DialogTrigger asChild>
                <li className="hover:bg-slate-200 rounded-md p-2 cursor-pointer list-none">
                    Log In
                </li>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="text-center text-xl font-bold text-slate-900">
                        Log In
                        <span className="block text-sm font-normal text-slate-600 mt-1">Welcome to Galloway Getaways</span>
                    </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleLogin} className="space-y-4 mt-2">
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
                    <Button type="submit" className="w-full py-3 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-xl">
                        Continue
                    </Button>
                </form>

                <div className="relative my-2">
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
                        <FcGoogle className="w-5 h-5" />
                        <span>Continue with Google</span>
                    </button>
                    <button
                        onClick={() => handleSocialLogin('apple')}
                        className="w-full py-3 px-4 border rounded-xl font-medium text-slate-700 hover:bg-slate-50 transition flex items-center justify-center space-x-2"
                    >
                        <AiFillApple className="w-5 h-5 text-black" />
                        <span>Continue with Apple</span>
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default LoginModel;