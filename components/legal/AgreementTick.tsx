'use client';

import { useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { AGREEMENTS, AgreementKey } from '@/lib/agreements';
import AgreementBody from '@/components/legal/AgreementBody';

// THE TICK BOX — one line, "I agree to the <underlined title>.", used at every
// point an agreement is accepted: account creation (Guest Terms), a host's
// first listing, the end of the provider and trade sign-ups, and the sign-in
// prompt. The underlined title opens the full text in a panel; the panel links
// to the document's own page for a new tab.
//
// Only the box. Whether it is required, and the words when it is missing, come
// from lib/agreements' agreementProblem — the same rule the server applies.

interface Props {
    doc: AgreementKey;
    checked: boolean;
    onChange: (checked: boolean) => void;
    error?: string;
    // Distinct ids when two could share a page.
    id?: string;
    // 'tab' opens the document's own page in a new tab instead of the panel —
    // for a box inside a dialog, where a second fixed panel can't sit on top.
    open?: 'panel' | 'tab';
}

export default function AgreementTick({ doc, checked, onChange, error, id, open: opens = 'panel' }: Props) {
    const [open, setOpen] = useState(false);
    const a = AGREEMENTS[doc];
    const inputId = id || `agree-${doc}`;

    return (
        <div>
            <div className="flex items-start gap-3">
                <input
                    id={inputId}
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-emerald-700"
                    aria-invalid={!!error}
                />
                <label htmlFor={inputId} className="text-sm text-slate-800">
                    I agree to the{' '}
                    {/* A button inside the label: pressing it opens the text and
                        does not toggle the box. */}
                    {opens === 'tab' ? (
                        <a
                            href={a.path}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-slate-900 underline underline-offset-2 hover:text-emerald-800"
                        >
                            {a.title}
                        </a>
                    ) : (
                        <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); setOpen(true); }}
                            className="font-semibold text-slate-900 underline underline-offset-2 hover:text-emerald-800"
                        >
                            {a.title}
                        </button>
                    )}.
                </label>
            </div>
            {error && <p data-problem role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
            {open && <AgreementPanel doc={doc} onClose={() => setOpen(false)} />}
        </div>
    );
}

// The full text in a panel — a sheet from the bottom on a phone, a centred
// dialog above that. Closing it changes nothing.
export function AgreementPanel({ doc, onClose }: { doc: AgreementKey; onClose: () => void }) {
    const a = AGREEMENTS[doc];
    return (
        <div
            className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label={a.title}
            onClick={onClose}
        >
            <div
                className="flex max-h-[85vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:max-w-2xl sm:rounded-3xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
                    <h3 className="text-base font-bold text-slate-900">{a.title}</h3>
                    <div className="flex items-center gap-1">
                        <a
                            href={a.path}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                        >
                            <ExternalLink className="h-3.5 w-3.5" /> Open in a new tab
                        </a>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close"
                            className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>
                <div className="overflow-y-auto px-5 py-5 text-sm sm:px-6">
                    <AgreementBody doc={doc} />
                </div>
            </div>
        </div>
    );
}

// Record an acceptance through the one server route. Resolves to null on
// success, or the words to show.
export async function recordAgreement(doc: AgreementKey, source: string): Promise<string | null> {
    try {
        const res = await fetch('/api/agreements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ document: doc, version: AGREEMENTS[doc].version, source }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.ok) return (body && body.error) || 'We couldn’t save that. Please try again.';
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(AGREEMENTS_CHANGED));
        return null;
    } catch {
        return 'We couldn’t save that. Check your connection and try again.';
    }
}

export const AGREEMENTS_CHANGED = 'gg:agreements-changed';

// A flow that asks for an agreement itself (the email sign-up's last screen)
// holds the sign-in prompt while it is on screen, so nobody sees two boxes.
let holds = 0;
export const GATE_HOLD_CHANGED = 'gg:agreement-gate-hold';
export function holdAgreementGate(): () => void {
    holds += 1;
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(GATE_HOLD_CHANGED));
    let released = false;
    return () => {
        if (released) return;
        released = true;
        holds = Math.max(0, holds - 1);
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(GATE_HOLD_CHANGED));
    };
}
export function agreementGateHeld(): boolean {
    return holds > 0;
}

// What the signed-in account has agreed to. null while unknown (or signed out).
export async function fetchAgreementStatus(): Promise<null | {
    documents: Record<AgreementKey, { version: string; agreed: boolean; earlier: boolean }>;
    // The next document owed at all (Guest Terms first).
    next: AgreementKey | null;
    // The next ROLE agreement owed, never the Guest Terms — what the sign-in
    // prompt shows now that the Guest Terms are taken at sign-up and checkout.
    nextRole: AgreementKey | null;
}> {
    try {
        const res = await fetch('/api/agreements', { cache: 'no-store' });
        if (!res.ok) return null;
        const body = await res.json();
        return body && body.ok
            ? { documents: body.documents, next: body.next, nextRole: body.nextRole ?? null }
            : null;
    } catch {
        return null;
    }
}
