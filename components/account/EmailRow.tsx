'use client';

import { useState } from 'react';
import { toast } from 'react-toastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { looksLikeEmail, tidyEmail } from '@/lib/emailCodeSignIn';

// The Account-details email row — the reverse of PhoneRow. Someone who signed up
// with a phone number can add an email here; once they confirm it from the link
// we send, the email is linked to this account's login (auth.users.email), so
// they can log in with either. Changing an existing email works the same way.
//
// Supabase sends the confirmation through the "Change email address" template,
// whose link comes back via /auth/callback?next=/account.

export default function EmailRow({ supabase, initialEmail }: {
    supabase: SupabaseClient;
    initialEmail: string;
}) {
    const [email] = useState(initialEmail);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [sent, setSent] = useState(false);

    const save = async () => {
        const next = tidyEmail(draft);
        if (!looksLikeEmail(next)) { setError('That email address doesn’t look right.'); return; }
        if (next === tidyEmail(email)) { setEditing(false); return; }
        setBusy(true);
        setError('');
        try {
            const redirect = `${window.location.origin}/auth/callback?next=/account`;
            const { error: uErr } = await supabase.auth.updateUser({ email: next }, { emailRedirectTo: redirect });
            if (uErr) {
                const m = String(uErr.message || '').toLowerCase();
                setError(/already|registered|exists|taken/.test(m)
                    ? 'That email is already on another account. Use a different one.'
                    : 'We couldn’t send the confirmation. Check the address and try again.');
                return;
            }
            setSent(true);
            setEditing(false);
            toast.success('Check your email to confirm it.', { theme: 'colored' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="p-5">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <div className="mb-1 text-sm font-semibold text-slate-900">Email</div>
                    {editing ? (
                        <input type="email" inputMode="email" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)}
                            placeholder="you@example.com" className="w-full max-w-sm rounded-lg border p-2 text-sm" />
                    ) : (
                        <div className="text-sm text-slate-500">{email || 'Not provided — add one to log in with email too'}</div>
                    )}
                    {sent && !editing && (
                        <p className="mt-2 text-xs text-slate-500">We’ve sent a confirmation link. The email becomes a login once you tap it.</p>
                    )}
                </div>
                {editing ? (
                    <div className="ml-4 flex items-center space-x-3">
                        <button type="button" onClick={() => { setEditing(false); setError(''); }} className="text-sm text-slate-500 hover:text-slate-800">Cancel</button>
                        <button type="button" onClick={save} disabled={busy}
                            className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-60">
                            {busy ? 'Sending…' : 'Save'}
                        </button>
                    </div>
                ) : (
                    <button type="button" onClick={() => { setDraft(email); setEditing(true); setError(''); setSent(false); }}
                        className="ml-4 flex-shrink-0 text-sm font-semibold text-slate-700 underline hover:text-black">
                        {email ? 'Change' : 'Add'}
                    </button>
                )}
            </div>
            {error && <p className="mt-2 text-sm font-semibold text-rose-600">{error}</p>}
        </div>
    );
}
