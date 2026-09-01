'use client';

import { useState } from 'react';

// A press, never automatic.
//
// If opening an expired link re-sent mail by itself, anybody with a stale link
// in an inbox could make us send email on demand — and the outbound allowance
// is shared with every password reset and booking confirmation on the site.
export default function ResendLink({ applicationId, email }: { applicationId: string; email: string }) {
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);

    const send = async () => {
        setBusy(true);
        try {
            await fetch('/api/services/resend-verification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ applicationId }),
            });
        } catch (err) {
            // The route answers the same whatever happened, so there is nothing
            // here that a failure would let us say honestly.
        } finally {
            setBusy(false);
            setSent(true);
        }
    };

    if (sent) {
        return (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-sm text-emerald-900">
                    <strong className="font-semibold">On its way.</strong> Check {email} — it usually
                    arrives within a minute or two.
                </p>
            </div>
        );
    }

    return (
        <>
            <button
                type="button"
                onClick={send}
                disabled={busy}
                className="w-full bg-emerald-700 text-white font-semibold rounded-xl py-3 hover:bg-emerald-800 transition disabled:opacity-60"
            >
                {busy ? 'Sending…' : 'Send me a new link'}
            </button>
            <p className="text-sm text-slate-500 mt-2 text-center">It will go to {email}.</p>
        </>
    );
}
