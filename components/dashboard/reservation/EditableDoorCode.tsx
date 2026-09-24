'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Eye, EyeOff, Check, Copy, Pencil, Loader2 } from 'lucide-react';

// The door code on the host reservation page — now editable for an upcoming
// booking. Showing/copying is unchanged; the new part is Edit, which sets a code
// for THIS booking only (a booking_access_codes override) without touching the
// property's standing code. Saving updates the guest's live arrival screen at
// once, and if their check-in message has already gone out, the route posts the
// new code into the conversation.
//
// The value only ever reaches this component after the server has checked
// can_listing — a co-host without the listing permission never has it read, and
// never sees this card at all.
export default function EditableDoorCode({
    bookingId,
    code,
    hasOverride,
    listingCode,
    editable,
}: {
    bookingId: string;
    code: string | null;
    hasOverride: boolean;
    listingCode: string | null;
    editable: boolean;
}) {
    const router = useRouter();
    const [shown, setShown] = useState(false);
    const [copied, setCopied] = useState(false);
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(hasOverride ? (code || '') : '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function copy() {
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch { /* on screen to read */ }
    }

    async function save(next: string) {
        setBusy(true);
        setError('');
        try {
            const res = await fetch('/api/bookings/access-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId, code: next }),
            });
            const d = await res.json().catch(() => ({}));
            if (d && d.ok) {
                setEditing(false);
                router.refresh();
            } else {
                setError((d && d.error) || 'Could not save.');
            }
        } catch {
            setError('Could not save.');
        }
        setBusy(false);
    }

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-slate-900">
                    <KeyRound className="h-4 w-4 flex-none text-slate-400" />
                    <span className="text-sm font-semibold">Door code</span>
                    {hasOverride && !editing && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Just for this booking</span>
                    )}
                </div>
                {editable && !editing && (
                    <button
                        type="button"
                        onClick={() => { setEditing(true); setValue(hasOverride ? (code || '') : ''); setError(''); }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-700 transition hover:border-slate-400"
                    >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                )}
            </div>

            {editing ? (
                <div className="mt-3">
                    <input
                        value={value}
                        onChange={(e) => setValue(e.target.value.slice(0, 40))}
                        placeholder={listingCode ? 'e.g. ' + listingCode : 'A code just for this guest'}
                        className="block w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-lg tracking-[0.15em] text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                    <p className="mt-2 text-xs text-slate-500">
                        This changes the code for this booking only. {listingCode ? 'The property’s standard code stays ' + listingCode + '.' : 'The property has no standard code set.'}
                    </p>
                    {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            disabled={busy || !value.trim()}
                            onClick={() => save(value.trim())}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                        >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save code
                        </button>
                        {hasOverride && (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => save('')}
                                className="text-[13px] font-semibold text-slate-600 underline hover:text-slate-900 disabled:opacity-50"
                            >
                                Use the standard code
                            </button>
                        )}
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => { setEditing(false); setError(''); }}
                            className="text-[13px] font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : code ? (
                <div className="mt-3 flex items-center gap-3">
                    <span className={`min-w-0 flex-1 font-mono text-2xl tracking-[0.2em] text-slate-900 ${shown ? '' : 'select-none'}`}>
                        {shown ? code : '••••'}
                    </span>
                    <button
                        type="button"
                        onClick={() => setShown((s) => !s)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                    >
                        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        {shown ? 'Hide' : 'Show'}
                    </button>
                    {shown && (
                        <button
                            type="button"
                            onClick={copy}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                        >
                            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                    )}
                </div>
            ) : (
                <p className="mt-2 text-sm text-slate-500">
                    No door code for this booking yet.{editable ? ' Add one with Edit — it applies to this guest only.' : ''}
                </p>
            )}

            {!editing && (
                <p className="mt-2 text-xs text-slate-400">
                    Only people you’ve given the listing to can see this. The guest gets it in their check-in message, never here.
                </p>
            )}
        </div>
    );
}
