'use client';

// Where a password-reset link lands, once the callback has swapped it for a
// session.
//
// Deliberately not the form in Account settings. That one re-signs-in with
// your current password before changing it, which is right for someone who
// knows it and useless for someone who has forgotten it. The link itself is
// the proof here — Supabase only issues it to the address on the account.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import Logo from '@/components/base/Logo';

export default function ResetPasswordPage() {
    const supabase = createClientComponentClient();
    const router = useRouter();

    const [checking, setChecking] = useState(true);
    const [signedIn, setSignedIn] = useState(false);
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const check = async () => {
            const { data } = await supabase.auth.getSession();
            setSignedIn(Boolean(data.session));
            setChecking(false);
        };
        check();
    }, [supabase]);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password.length < 8) {
            setError('Use at least 8 characters.');
            return;
        }
        if (password !== confirm) {
            setError('Those two passwords are not the same.');
            return;
        }

        setSaving(true);
        const { error: updateError } = await supabase.auth.updateUser({ password });
        setSaving(false);

        if (updateError) {
            setError(updateError.message);
            return;
        }

        toast.success('Password changed. You are signed in.', { theme: 'colored' });
        router.push('/');
        router.refresh();
    };

    if (checking) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4">
                <Logo />
                <p className="text-slate-500 animate-pulse">Checking your link…</p>
            </div>
        );
    }

    // No session means the callback did not land one before sending you here —
    // usually because this page was opened directly, or the link was too old to
    // use. Do NOT diagnose it as "already used": that copy is what hid the bug
    // where a mail scanner spent the link before the recipient — reported here as
    // a link the recipient had somehow used up. The interstitial on the callback
    // now stops the scanner from spending it; if there is still no session, the
    // honest answer is simply to ask for a fresh link.
    if (!signedIn) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4 text-center px-6">
                <Logo />
                <h1 className="text-2xl font-bold text-slate-900">Ask for a fresh reset link</h1>
                <p className="text-slate-600 max-w-sm">
                    This page needs a live reset link. Request one from the log in box and
                    open it here, then you can set a new password. Reset links run out after
                    an hour.
                </p>
            </div>
        );
    }

    return (
        <div className="max-w-sm mx-auto px-6 py-16">
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Choose a new password</h1>
            <p className="text-sm text-slate-600 mb-6">
                Use at least 8 characters. You&apos;ll stay signed in afterwards.
            </p>

            <form onSubmit={save} className="space-y-3">
                <div>
                    <label className="text-xs text-slate-500">New password</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        className="w-full p-2.5 border rounded-lg text-sm mt-1"
                        required
                    />
                </div>
                <div>
                    <label className="text-xs text-slate-500">Type it again</label>
                    <input
                        type="password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        autoComplete="new-password"
                        className="w-full p-2.5 border rounded-lg text-sm mt-1"
                        required
                    />
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <button
                    type="submit"
                    disabled={saving}
                    className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-xl transition disabled:opacity-50"
                >
                    {saving ? 'Saving…' : 'Save new password'}
                </button>
            </form>
        </div>
    );
}
