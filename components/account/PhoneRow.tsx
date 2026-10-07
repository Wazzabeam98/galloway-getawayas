'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ukMobileToE164, displayPhone } from '@/lib/signInIdentifier';
import { tidyCode } from '@/lib/emailCodeSignIn';

// The Account-details "Phone number" row, now a login identity, not just a
// contact field. Saving a number stores it on the profile AND starts a text-code
// confirmation (Supabase's phone-change OTP); once the code is entered the number
// is linked to this account's login (auth.users.phone), so from then on logging
// in with it opens this account and the email still works too.
//
// A number already confirmed on ANOTHER account can't be taken — Supabase
// refuses the change and we say so. An existing, unconfirmed number (saved before
// this existed) shows a "Confirm your number" prompt.

const digits = (s: string | null | undefined) => String(s || '').replace(/\D/g, '');

export default function PhoneRow({ supabase, initialPhone, onSaved }: {
    supabase: SupabaseClient;
    initialPhone: string;
    onSaved: (phone: string) => void;
}) {
    const [phone, setPhone] = useState(initialPhone);
    // The confirmed login phone on auth.users (digits, e.g. "447700900123").
    const [loginPhone, setLoginPhone] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(initialPhone);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    // The code step: a number is awaiting its texted code to be confirmed.
    const [pending, setPending] = useState<string | null>(null); // the E.164 awaiting confirmation
    const [code, setCode] = useState('');
    const [verifying, setVerifying] = useState(false);

    const readLogin = async () => {
        const { data } = await supabase.auth.getUser();
        const u = data?.user;
        setLoginPhone(u?.phone && u.phone_confirmed_at ? digits(u.phone) : null);
    };
    useEffect(() => { readLogin(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

    const confirmed = !!phone && loginPhone === digits(phone);

    // Start the text-code confirmation for an E.164 number: write it to the
    // profile, then ask Supabase to change the login phone (which texts a code).
    const startConfirm = async (e164: string) => {
        setError('');
        setSaving(true);
        try {
            const { error: pErr } = await supabase.from('profiles').update({ phone: e164 }).eq('id', (await supabase.auth.getUser()).data.user?.id);
            if (pErr) { setError('Couldn’t save that number. Try again.'); return; }
            setPhone(e164);
            onSaved(e164);
            const { error: uErr } = await supabase.auth.updateUser({ phone: e164 });
            if (uErr) {
                const m = String(uErr.message || '').toLowerCase();
                if (/already|registered|exists|taken/.test(m)) {
                    setError('That number is already on another account. Use a different one.');
                } else if (/sms|provider|otp|rate|security/.test(m)) {
                    setError('We couldn’t text a code just now. Try again shortly.');
                } else {
                    setError('We couldn’t start confirmation. Try again.');
                }
                return;
            }
            setPending(e164);
            setEditing(false);
            setCode('');
        } finally {
            setSaving(false);
        }
    };

    const onSave = async () => {
        const e164 = ukMobileToE164(draft);
        if (!e164) { setError('Enter a UK mobile number (07… or +44 7…).'); return; }
        await startConfirm(e164);
    };

    const verify = async () => {
        if (!pending) return;
        const token = tidyCode(code);
        if (token.length < 6) { setError('Enter the 6-digit code we texted you.'); return; }
        setVerifying(true);
        setError('');
        try {
            const { error: vErr } = await supabase.auth.verifyOtp({ phone: pending, token, type: 'phone_change' });
            if (vErr) { setError('That code didn’t work. Check it, or send a new one.'); return; }
            setPending(null);
            setCode('');
            await readLogin();
            toast.success('Number confirmed — you can now log in with it.', { theme: 'colored' });
        } finally {
            setVerifying(false);
        }
    };

    return (
        <div className="p-5">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <div className="mb-1 text-sm font-semibold text-slate-900">Phone number</div>
                    {editing ? (
                        <input type="tel" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)}
                            placeholder="07700 900123" className="w-full max-w-sm rounded-lg border p-2 text-sm" />
                    ) : (
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <span>{phone ? displayPhone(phone) : 'Not provided'}</span>
                            {phone && confirmed && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Confirmed</span>
                            )}
                        </div>
                    )}
                    {/* The confirm prompt for a saved-but-unconfirmed number. */}
                    {!editing && !pending && phone && !confirmed && (
                        <button type="button" onClick={() => startConfirm(ukMobileToE164(phone) || phone)}
                            className="mt-2 inline-flex items-center rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:border-amber-400">
                            Confirm your number
                        </button>
                    )}
                </div>
                {!pending && (editing ? (
                    <div className="ml-4 flex items-center space-x-3">
                        <button type="button" onClick={() => { setEditing(false); setDraft(phone); setError(''); }} className="text-sm text-slate-500 hover:text-slate-800">Cancel</button>
                        <button type="button" onClick={onSave} disabled={saving}
                            className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-60">
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                ) : (
                    <button type="button" onClick={() => { setDraft(phone); setEditing(true); setError(''); }}
                        className="ml-4 flex-shrink-0 text-sm font-semibold text-slate-700 underline hover:text-black">
                        {phone ? 'Edit' : 'Add'}
                    </button>
                ))}
            </div>

            {/* The texted-code step. */}
            {pending && (
                <div className="mt-3 max-w-sm rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-sm text-slate-700">We texted a code to <span className="font-semibold">{displayPhone(pending)}</span>. Enter it to confirm.</div>
                    <div className="mt-2 flex items-center gap-2">
                        <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code"
                            className="w-32 rounded-lg border p-2 text-sm tracking-widest" />
                        <button type="button" onClick={verify} disabled={verifying}
                            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                            {verifying ? 'Confirming…' : 'Confirm'}
                        </button>
                        <button type="button" onClick={() => { setPending(null); setCode(''); setError(''); }} className="text-sm text-slate-500 hover:text-slate-800">Cancel</button>
                    </div>
                </div>
            )}

            {error && <p className="mt-2 text-sm font-semibold text-rose-600">{error}</p>}
        </div>
    );
}
