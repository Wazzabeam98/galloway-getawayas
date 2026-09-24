'use client';

import { useState } from 'react';
import { StickyNote, Check } from 'lucide-react';

// The host's private note on a booking. Only people who manage the booking
// (owner or a co-host with can_bookings) ever see this page, and the note is
// walled from the guest at the database (bookings.host_note is not granted to
// the browser roles). Saves through /api/bookings/host-note, which re-checks
// can_bookings server-side.
export default function HostNotes({ bookingId, initial }: { bookingId: string; initial: string | null }) {
    const [note, setNote] = useState(initial || '');
    const [saved, setSaved] = useState(initial || '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [justSaved, setJustSaved] = useState(false);

    const dirty = note.trim() !== saved.trim();

    async function save() {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch('/api/bookings/host-note', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId, note }),
            });
            const d = await res.json().catch(() => ({}));
            if (d && d.ok) {
                setSaved(note);
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
            <p className="mt-1 text-[13px] text-slate-500">Only you can see this — never the guest.</p>
            <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 2000))}
                rows={3}
                placeholder="A reminder to yourself about this booking…"
                className="mt-3 block w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            <div className="mt-2 flex items-center gap-3">
                <button
                    type="button"
                    onClick={save}
                    disabled={busy || !dirty}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                >
                    {busy ? 'Saving…' : 'Save note'}
                </button>
                {justSaved && (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
                        <Check className="h-4 w-4" /> Saved
                    </span>
                )}
                {error && <span className="text-sm text-rose-700">{error}</span>}
            </div>
        </section>
    );
}
