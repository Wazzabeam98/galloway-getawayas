'use client';

import { useEffect, useState } from 'react';
import { StickyNote, Check, Loader2 } from 'lucide-react';

// A provider's private note on an experience order — the experience twin of the
// stay-side HostNotes. Kept separate from the guest's own note (which the
// provider sees read-only, as the guest's words) and labelled so it is never
// mistaken for something the guest can see. It fetches its own value on mount
// and saves through /api/services/orders/host-note (owner-checked, service
// role), so it drops into the provider dashboards without changing the orders
// feed. Walled at the database: order_host_notes has no browser grants.
export default function OrderHostNotes({ orderId }: { orderId: string }) {
    const [note, setNote] = useState('');
    const [saved, setSaved] = useState('');
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
                if (live && d && d.ok) { setNote(d.note || ''); setSaved(d.note || ''); }
            } catch { /* leave blank */ }
            if (live) setLoaded(true);
        })();
        return () => { live = false; };
    }, [orderId]);

    const dirty = note.trim() !== saved.trim();

    async function save() {
        setBusy(true);
        setError('');
        try {
            const res = await fetch('/api/services/orders/host-note', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId, note }),
            });
            const d = await res.json().catch(() => ({}));
            if (d && d.ok) { setSaved(note); setJustSaved(true); setTimeout(() => setJustSaved(false), 1800); }
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
            <p className="mt-0.5 text-[12px] text-slate-500">Only you can see this — never the guest.</p>
            <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 2000))}
                rows={2}
                disabled={!loaded}
                placeholder={loaded ? 'A reminder to yourself about this order…' : 'Loading…'}
                className="mt-2 block w-full resize-y rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-slate-50"
            />
            <div className="mt-2 flex items-center gap-2">
                <button
                    type="button"
                    onClick={save}
                    disabled={busy || !dirty || !loaded}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save note
                </button>
                {justSaved && <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-700"><Check className="h-3.5 w-3.5" /> Saved</span>}
                {error && <span className="text-[13px] text-rose-700">{error}</span>}
            </div>
        </div>
    );
}
