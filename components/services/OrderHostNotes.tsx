'use client';

import { useEffect, useState } from 'react';
import { StickyNote, Check, Loader2 } from 'lucide-react';

interface Note { host_note: string; created_at: string }

function stamp(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        + ', ' + d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// A provider's private notes on an experience order — an APPEND-ONLY log, the
// experience twin of the stay-side HostNotes. Kept separate from the guest's own
// note (shown read-only, as the guest's words) and labelled so it is never
// mistaken for something the guest can see. Each note is saved with its date and
// time and cannot be edited or deleted; the provider adds a new one. Fetches its
// own log on mount and saves through /api/services/orders/host-note (owner-
// checked, service role, insert only). Walled at the database.
export default function OrderHostNotes({ orderId }: { orderId: string }) {
    const [notes, setNotes] = useState<Note[]>([]);
    const [draft, setDraft] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let live = true;
        (async () => {
            try {
                const res = await fetch('/api/services/orders/host-note?order=' + encodeURIComponent(orderId));
                const d = await res.json().catch(() => ({}));
                if (live && d && d.ok) setNotes(d.notes || []);
            } catch { /* leave blank */ }
            if (live) setLoaded(true);
        })();
        return () => { live = false; };
    }, [orderId]);

    async function add() {
        const note = draft.trim();
        if (!note) return;
        setBusy(true);
        setError('');
        try {
            const res = await fetch('/api/services/orders/host-note', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId, note }),
            });
            const d = await res.json().catch(() => ({}));
            if (d && d.ok && d.note) { setNotes((n) => [...n, d.note]); setDraft(''); setJustSaved(true); setTimeout(() => setJustSaved(false), 1800); }
            else setError((d && d.error) || 'Could not save.');
        } catch { setError('Could not save.'); }
        setBusy(false);
    }

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-1.5 text-slate-900">
                <StickyNote className="h-3.5 w-3.5 flex-none text-slate-400" />
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your notes</span>
            </div>
            <p className="mt-0.5 text-[12px] text-slate-500">Only you can see this — never the guest. Kept with the date added; can’t be changed after.</p>

            {notes.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                    {notes.map((n, i) => (
                        <li key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                            <p className="whitespace-pre-line text-sm text-slate-800">{n.host_note}</p>
                            <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">{stamp(n.created_at)}</p>
                        </li>
                    ))}
                </ul>
            )}

            <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 2000))}
                rows={2}
                disabled={!loaded}
                placeholder={loaded ? (notes.length ? 'Add another note…' : 'A reminder to yourself about this order…') : 'Loading…'}
                className="mt-2 block w-full resize-y rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-slate-50"
            />
            <div className="mt-2 flex items-center gap-2">
                <button
                    type="button"
                    onClick={add}
                    disabled={busy || !draft.trim() || !loaded}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Add note
                </button>
                {justSaved && <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-700"><Check className="h-3.5 w-3.5" /> Added</span>}
                {error && <span className="text-[13px] text-rose-700">{error}</span>}
            </div>
        </div>
    );
}
