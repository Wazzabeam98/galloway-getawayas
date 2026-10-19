'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { GooseMark } from '@/components/base/Logo';
import NameFields, { NameError, saveMyName } from '@/components/auth/NameFields';
import { mustFinishSignUp, needsPersonName, suggestedName } from '@/lib/personName';

/**
 * "Finish signing up" — first and last name, and it cannot be closed.
 *
 * The sign-in panel asks for the name itself straight after the code
 * (components/auth/AuthPanel). This catches every way past that: a tab closed
 * on that screen, a Google sign-in (which comes back through /auth/callback,
 * not the panel — the names Google gave are filled in for them to confirm), an
 * account made for a guest at checkout. Mounted once, in the root layout, and
 * checked once per page load; it never fires mid-flow on a sign-in.
 *
 * Who sees it on page load: accounts made since names became compulsory and
 * still without one (mustFinishSignUp). A returning account never does.
 *
 * On request — requireName() — it asks ANY nameless account. The listing and
 * experience wizards call it when they open, and they and the dashboards call
 * it before publishing, so an older account with no name is asked first,
 * before anything else (Liam, 19 Oct 2026). The promise resolves true once a
 * name is on the account (straight away if one already is).
 */

const ASK = 'gg:require-name';

export function requireName(): Promise<boolean> {
    return new Promise((resolve) => {
        window.dispatchEvent(new CustomEvent(ASK, { detail: { resolve } }));
    });
}

const INPUT = 'w-full rounded-xl border border-slate-400 px-4 py-3.5 text-base text-slate-900 placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900';
const PRIMARY = 'w-full rounded-xl bg-emerald-700 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400';

export default function FinishSignUpGate() {
    const supabase = createClientComponentClient();
    const [open, setOpen] = useState(false);
    const [fromGoogle, setFromGoogle] = useState(false);
    const [first, setFirst] = useState('');
    const [last, setLast] = useState('');
    const [error, setError] = useState<NameError>(null);
    const [busy, setBusy] = useState(false);
    const waiting = useRef<((ok: boolean) => void)[]>([]);
    const firstField = useRef<HTMLInputElement>(null);

    // Loads the account and decides. `strict` asks any nameless account;
    // otherwise only one made since names became compulsory.
    const check = useCallback(async (strict: boolean): Promise<boolean> => {
        const { data } = await supabase.auth.getSession();
        if (!(data && data.session)) return false;
        // The full user from the auth server: the copy in the session cookie
        // is trimmed and carries no created_at.
        const { data: got } = await supabase.auth.getUser();
        const user = got && got.user;
        if (!user) return false;
        const { data: prof } = await supabase
            .from('profiles').select('full_name, first_name, last_name').eq('id', user.id).maybeSingle();
        // A failed read (no row yet, a blip) is not a reason to block a page.
        if (!prof) return false;
        const ask = strict ? needsPersonName(prof) : mustFinishSignUp(prof, user.created_at, user.email);
        if (!ask) return false;
        const md = user.user_metadata || {};
        const s = suggestedName(prof, md);
        setFirst(s.first);
        setLast(s.last);
        const provider = (user.app_metadata && user.app_metadata.provider) || '';
        setFromGoogle(provider === 'google' && !!(s.first || s.last));
        setError(null);
        setOpen(true);
        return true;
    }, [supabase]);

    useEffect(() => {
        // Not on the auth hand-off routes, which redirect straight on.
        if (window.location.pathname.startsWith('/auth/')) return;
        check(false);
    }, [check]);

    useEffect(() => {
        const onAsk = async (e: Event) => {
            const resolve = (e as CustomEvent).detail && (e as CustomEvent).detail.resolve;
            const asked = await check(true);
            if (!resolve) return;
            if (!asked) {
                // Already named — or nobody signed in, which the caller's own
                // sign-in step deals with.
                const { data } = await supabase.auth.getSession();
                resolve(!!(data && data.session));
                return;
            }
            waiting.current.push(resolve);
        };
        window.addEventListener(ASK, onAsk);
        return () => window.removeEventListener(ASK, onAsk);
    }, [check, supabase]);

    useEffect(() => {
        if (!open) return;
        if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return;
        firstField.current?.focus();
    }, [open]);

    const submit = async (e?: FormEvent) => {
        e?.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        const err = await saveMyName(supabase, first, last);
        setBusy(false);
        if (err) { setError(err); return; }
        setOpen(false);
        const done = waiting.current;
        waiting.current = [];
        if (done.length) { done.forEach((r) => r(true)); return; }
        // Asked on page load: reload so every name on the page is the new one.
        window.location.reload();
    };

    if (!open) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center sm:px-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="finish-signup-heading"
        >
            <div className="relative max-h-[100dvh] w-full overflow-y-auto rounded-t-3xl bg-white px-6 pb-8 pt-6 shadow-2xl sm:max-w-[480px] sm:rounded-3xl sm:px-8">
                <div className="h-8" />
                <GooseMark className="mx-auto mb-3 h-auto w-12 text-emerald-700" />
                <h2 id="finish-signup-heading" className="text-center text-2xl font-semibold tracking-tight text-slate-900">
                    Finish signing up
                </h2>
                <p className="mt-2 text-center text-slate-600 [text-wrap:pretty]">
                    {fromGoogle ? 'We’ve filled in your name from Google. Check it’s right.' : 'What’s your name?'}
                </p>
                <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
                    <NameFields
                        idPrefix="finish"
                        first={first}
                        last={last}
                        onFirst={(v) => { setFirst(v); setError(null); }}
                        onLast={(v) => { setLast(v); setError(null); }}
                        error={error}
                        inputClass={INPUT}
                        labelClass="mb-1.5 block text-xs font-medium text-slate-600"
                        firstRef={firstField}
                    />
                    {error && <p role="alert" className="text-sm text-red-600">{error.message}</p>}
                    <button type="submit" disabled={busy || !first.trim() || !last.trim()} className={PRIMARY}>
                        {busy ? 'Saving…' : fromGoogle ? 'Confirm and continue' : 'Continue'}
                    </button>
                </form>
            </div>
        </div>,
        document.body
    );
}
