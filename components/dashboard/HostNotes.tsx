'use client';

import { useState } from 'react';
import { StickyNote, Check, Loader2 } from 'lucide-react';

export interface HostNote { host_note: string; created_at: string }

function stamp(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        + ', ' + d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// The host's private notes on a booking — an APPEND-ONLY log. Only people who
// manage the booking (owner or a co-host with can_bookings) ever see this page,
// and the notes are walled from the guest at the database. Each note is saved
// with its date and time and cannot be edited or deleted once saved; the host
// adds a new one. Saves through /api/bookings/host-note, which re-checks
// can_bookings server-side and only ever inserts.
export default function HostNotes({ bookingId, notes: initial }: { bookingId: string; notes: HostNote[] }) {
    const [notes, setNotes] = useState<HostNote[]>(initial || []);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [justSaved, setJustSaved] = useState(false);

    async function add() {
        const note = draft.trim();
        if (!note) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch('/api/bookings/host-note', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId, note }),
            });
            const d = await res.json().catch(() => ({}));
            if (d && d.ok && d.note) {
                setNotes((n) => [...n, d.note]);
                setDraft('');
                setJustSaved(true);
                setTimeout(() => setJustSaved(false), 1800);
            } else {
                setError((d && d.error) || 'Could not save.');
            }
        } catch {
            setError('Could not save.');
        }
        setBusy(false);
    }

    return (
        <section className="border-t border-slate-200 pt-6">
            <div className="flex items-center gap-2 text-slate-900">
                <StickyNote className="h-4 w-4 flex-none text-slate-400" />
                <h2 className="text-lg font-semibold">Your notes</h2>
            </div>
            <p className="mt-1 text-[13px] text-slate-500">Only you can see this — never the guest. Notes are kept with the date you added them and can’t be changed after.</p>

            {notes.length > 0 && (
                <ul className="mt-3 space-y-2">
                    {notes.map((n, i) => (
                        <li key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="whitespace-pre-line text-sm text-slate-800">{n.host_note}</p>
                            <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{stamp(n.created_at)}</p>
                        </li>
                    ))}
                </ul>
            )}

            <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 2000))}
                rows={3}
                placeholder={notes.length ? 'Add another note…' : 'A reminder to yourself about this booking…'}
                className="mt-3 block w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            <div className="mt-2 flex items-center gap-3">
                <button
                    type="button"
                    onClick={add}
                    disabled={busy || !draft.trim()}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add note
                </button>
                {justSaved && (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
                        <Check className="h-4 w-4" /> Added
                    </span>
                )}
                {error && <span className="text-sm text-rose-700">{error}</span>}
            </div>
        </section>
    );
}
