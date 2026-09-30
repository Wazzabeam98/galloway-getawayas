'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { AGREEMENTS, AgreementKey, agreementProblem, versionForTick } from '@/lib/agreements';
import AgreementTick, {
    AGREEMENTS_CHANGED,
    GATE_HOLD_CHANGED,
    agreementGateHeld,
    fetchAgreementStatus,
    recordAgreement,
} from '@/components/legal/AgreementTick';

// THE SIGN-IN PROMPT. Anyone signed in who owes an agreement — the Terms of
// Service for everyone; the Host, Experience Provider or Tradesperson Agreement
// for someone already in that role — is shown ONE document here, the next one
// owed, and can't use the site behind it until they agree. It is how accounts
// that could never tick a box are caught: everyone who signed up before the
// agreements existed, Google sign-ups, the guest accounts made at checkout, and
// anyone whose recorded version is out of date after a wording change.
//
// Never shown on the agreements' own pages (so the text can be read in a new
// tab), on /privacy, or during the auth callback.

const QUIET_PATHS = ['/terms', '/privacy', '/auth', '/cancellation-policy'];

const LINES: Record<AgreementKey, { fresh: string; changed: string }> = {
    guest: {
        fresh: 'Before you carry on, please read and agree to our Guest Terms. They cover your account, bookings and how the site works.',
        changed: 'We’ve updated our Guest Terms. Please read and agree to them to keep using Galloway Getaways.',
    },
    host: {
        fresh: 'Hosting now has its own agreement, on top of our Guest Terms. Please read it and agree to keep hosting.',
        changed: 'We’ve updated the Host Agreement. Please read it and agree to keep hosting.',
    },
    experience_provider: {
        fresh: 'Offering experiences now has its own agreement, on top of our Guest Terms. Please read it and agree to keep your listing.',
        changed: 'We’ve updated the Experience Provider Agreement. Please read it and agree to keep your listing.',
    },
    tradesperson: {
        fresh: 'Taking jobs through us now has its own agreement, on top of our Guest Terms. Please read it and agree to keep your listing.',
        changed: 'We’ve updated the Tradesperson Agreement. Please read it and agree to keep your listing.',
    },
};

export default function AgreementGate() {
    const supabase = createClientComponentClient();
    const pathname = usePathname() || '/';
    const [owed, setOwed] = useState<AgreementKey | null>(null);
    const [earlier, setEarlier] = useState(false);
    const [ticked, setTicked] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const quiet = QUIET_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

    const check = useCallback(async () => {
        if (agreementGateHeld()) { setOwed(null); return; }
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setOwed(null); return; }
        const status = await fetchAgreementStatus();
        if (agreementGateHeld()) { setOwed(null); return; }
        const next = status ? status.next : null;
        setOwed(next);
        setEarlier(!!(next && status && status.documents[next] && status.documents[next].earlier));
        setTicked(false);
        setError('');
        // supabase is stable for the life of the page.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        check();
    }, [check, pathname]);

    useEffect(() => {
        const { data: sub } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') check();
        });
        const onChange = () => check();
        window.addEventListener(AGREEMENTS_CHANGED, onChange);
        window.addEventListener(GATE_HOLD_CHANGED, onChange);
        return () => {
            sub.subscription.unsubscribe();
            window.removeEventListener(AGREEMENTS_CHANGED, onChange);
            window.removeEventListener(GATE_HOLD_CHANGED, onChange);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [check]);

    if (!owed || quiet) return null;

    const a = AGREEMENTS[owed];

    const agree = async () => {
        // The same rule the server applies to the POST below.
        const problem = agreementProblem(owed, null, versionForTick(owed, ticked));
        if (problem) { setError(problem); return; }
        setBusy(true);
        setError('');
        const failed = await recordAgreement(owed, 'prompt');
        setBusy(false);
        if (failed) { setError(failed); return; }
        // recordAgreement fires AGREEMENTS_CHANGED, which re-checks and shows
        // the next document owed, if there is one.
    };

    const logOut = async () => {
        await supabase.auth.signOut();
        window.location.href = '/';
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="agreement-gate-title">
            <div className="w-full rounded-t-3xl bg-white px-5 pb-6 pt-6 shadow-xl sm:max-w-md sm:rounded-3xl sm:px-7 sm:pt-7">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">
                    {earlier ? 'Updated' : 'One more thing'}
                </p>
                <h2 id="agreement-gate-title" className="mb-2 text-xl font-bold tracking-tight text-slate-900">
                    {earlier ? `We’ve updated our ${a.title}` : `Our ${a.title}`}
                </h2>
                <p className="mb-5 text-sm text-slate-600 [text-wrap:pretty]">
                    {earlier ? LINES[owed].changed : LINES[owed].fresh}
                </p>
                <AgreementTick
                    doc={owed}
                    id="agreement-gate-tick"
                    checked={ticked}
                    onChange={(v) => { setTicked(v); setError(''); }}
                    error={error}
                />
                <button
                    type="button"
                    onClick={agree}
                    disabled={busy}
                    className="mt-5 w-full rounded-xl bg-emerald-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
                >
                    {busy ? 'Saving…' : 'Agree and continue'}
                </button>
                <button
                    type="button"
                    onClick={logOut}
                    className="mt-3 w-full rounded-xl px-6 py-2 text-sm font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900"
                >
                    Not now — log out
                </button>
            </div>
        </div>
    );
}
