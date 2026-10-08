'use client';

import { useEffect, useState } from 'react';
import { AGREEMENTS, agreementUpdateNotice, type AgreementKey } from '@/lib/agreements';
import AgreementTick, { fetchAgreementStatus, recordAgreement, AGREEMENTS_CHANGED } from '@/components/legal/AgreementTick';

// THE DASHBOARD UPDATE NOTICE for a role agreement — the Host Agreement on the
// host dashboard, the Experience Provider / Tradesperson Agreement on the
// provider dashboard. Shown when this account's role needs the agreement and it
// is not on record at the current version: usually because the wording was
// bumped (lib/agreements.ts) after they agreed. It says what changed
// (`changeSummary`), links the full text, and records the acceptance through
// /api/agreements. It never blocks anything and disappears once agreed. Nothing
// renders until the status is known, so it never flashes up for someone who has
// already agreed.
// `className` sits on an outer wrapper that only renders with the notice, so a
// page's spacing around it disappears too when there is nothing to show.
export default function AgreementUpdateNotice({ doc, source, className }: { doc: Exclude<AgreementKey, 'guest'>; source: string; className?: string }) {
    const [notice, setNotice] = useState<null | { earlier: boolean; summary: string }>(null);
    const [ticked, setTicked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const a = AGREEMENTS[doc];

    useEffect(() => {
        let cancelled = false;
        const load = () => fetchAgreementStatus().then((st) => {
            if (!cancelled) setNotice(agreementUpdateNotice(doc, st && st.documents ? st.documents[doc] : null));
        });
        load();
        window.addEventListener(AGREEMENTS_CHANGED, load);
        return () => { cancelled = true; window.removeEventListener(AGREEMENTS_CHANGED, load); };
    }, [doc]);

    if (done) {
        return (
            <div className={className}>
                <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    Thanks — you’ve agreed to the {a.title}.
                </div>
            </div>
        );
    }
    if (!notice) return null;

    const agree = async () => {
        if (!ticked) { setError(`Tick the box to agree to the ${a.title}.`); return; }
        setBusy(true);
        setError('');
        const problem = await recordAgreement(doc, source);
        setBusy(false);
        if (problem) { setError(problem); return; }
        setDone(true);
    };

    return (
        <div className={className}>
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <h2 className="font-semibold text-slate-900">
                {notice.earlier ? `We’ve updated the ${a.title}` : `Please agree to the ${a.title}`}
            </h2>
            <p className="text-sm text-slate-700 mt-0.5">
                {notice.summary || (notice.earlier ? 'Please read the new version and agree to it.' : 'Please read it and agree to it.')}{' '}
                <a href={a.path} target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-900 underline underline-offset-2 hover:text-emerald-800">
                    Read the full agreement
                </a>
            </p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <AgreementTick doc={doc} checked={ticked} onChange={(v) => { setTicked(v); setError(''); }} id={`update-${doc}`} />
                <button
                    type="button"
                    onClick={agree}
                    disabled={busy}
                    className="flex-none self-start sm:self-auto rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                    {busy ? 'Saving…' : 'Agree'}
                </button>
            </div>
            {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
        </div>
        </div>
    );
}
