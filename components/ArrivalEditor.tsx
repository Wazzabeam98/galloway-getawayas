'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { EditorCard, EditorPanel, PanelSave } from '@/components/listing-editor/EditorPanel';
import AutoTextarea from '@/components/AutoTextarea';

// The host-facing editors for a listing's arrival details — the wifi,
// directions and what3words cards in the editor's Arrival section. Every field is
// independently optional and none of it goes into publish validation. Reads and
// writes go through /api/listings/arrival, which gates on can_listing and is the
// only door to the grant-less table. The door code is edited by LockboxCode
// through its own secure route.

type ArrivalKey = 'arrival_directions' | 'wifi_name' | 'wifi_password' | 'what3words';

function useArrival(listingId: string) {
    const [loaded, setLoaded] = useState(false);
    // What the GET returned, so save sends ONLY the fields the host actually
    // changed. If the GET fails or races, this stays empty and the host's one
    // typed field is all that gets sent — the untouched wifi password is never
    // in the body, so the partial-update route cannot blank it.
    const [base, setBase] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetch('/api/listings/arrival?listing=' + encodeURIComponent(listingId))
            .then((r) => r.json())
            .then((d) => {
                const a = (d && d.arrival) || {};
                setBase({
                    arrival_directions: a.arrival_directions || '',
                    wifi_name: a.wifi_name || '',
                    wifi_password: a.wifi_password || '',
                    what3words: a.what3words || '',
                });
                setLoaded(true);
            })
            .catch(() => setLoaded(true));
    }, [listingId]);

    async function save(current: Partial<Record<ArrivalKey, string>>): Promise<boolean> {
        setSaving(true); setError('');
        let ok = false;
        try {
            const payload: any = { listingId };
            for (const k of Object.keys(current) as ArrivalKey[]) {
                if (current[k] !== (base[k] ?? '')) payload[k] = current[k];
            }
            const res = await fetch('/api/listings/arrival', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const d = await res.json();
            if (d && d.ok) { setBase((b) => ({ ...b, ...current })); ok = true; }
            else setError((d && d.error) || 'Could not save.');
        } catch { setError('Could not save.'); }
        setSaving(false);
        return ok;
    }

    return { loaded, base, saving, error, save };
}

const inputClass = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700';

// "Wifi · HarbourCottage" on a raised card; the name and password behind it.
export function WifiCard({ listingId }: { listingId: string }) {
    const arrival = useArrival(listingId);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [pw, setPw] = useState('');
    const [showPw, setShowPw] = useState(false);

    const openPanel = () => {
        setName(arrival.base.wifi_name || '');
        setPw(arrival.base.wifi_password || '');
        setShowPw(false);
        setOpen(true);
    };

    const save = async () => {
        if (await arrival.save({ wifi_name: name, wifi_password: pw })) setOpen(false);
    };

    const summary = !arrival.loaded ? 'Loading…' : (arrival.base.wifi_name || 'Not set');

    return (
        <>
            <EditorCard title="Wifi" summary={summary} onClick={() => arrival.loaded && openPanel()} />
            {open && (
                <EditorPanel title="Wifi" onClose={() => setOpen(false)}
                    footer={
                        <div className="flex items-center justify-end gap-3">
                            {arrival.error && <span className="text-sm text-red-600">{arrival.error}</span>}
                            <PanelSave onClick={save} disabled={arrival.saving} />
                        </div>
                    }>
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="wifi-name" className="block text-sm font-semibold text-slate-900 mb-1">Network name</label>
                            <input id="wifi-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="HarbourCottage" className={inputClass} />
                        </div>
                        <div>
                            <label htmlFor="wifi-password" className="block text-sm font-semibold text-slate-900 mb-1">Password</label>
                            <div className="relative">
                                <input id="wifi-password" type={showPw ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" className={inputClass + ' pr-10'} />
                                <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label={showPw ? 'Hide password' : 'Show password'}>
                                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                        </div>
                    </div>
                </EditorPanel>
            )}
        </>
    );
}

// "what3words" on a raised card, the field behind it.
export function What3wordsCard({ listingId }: { listingId: string }) {
    const arrival = useArrival(listingId);
    const [open, setOpen] = useState(false);
    const [w3w, setW3w] = useState('');

    const save = async () => {
        if (await arrival.save({ what3words: w3w })) setOpen(false);
    };

    const summary = !arrival.loaded ? 'Loading…' : (arrival.base.what3words || 'Not set');

    return (
        <>
            <EditorCard title="what3words" summary={summary} onClick={() => { if (arrival.loaded) { setW3w(arrival.base.what3words || ''); setOpen(true); } }} />
            {open && (
                <EditorPanel title="what3words" onClose={() => setOpen(false)}
                    footer={
                        <div className="flex items-center justify-end gap-3">
                            {arrival.error && <span className="text-sm text-red-600">{arrival.error}</span>}
                            <PanelSave onClick={save} disabled={arrival.saving} />
                        </div>
                    }>
                    <label htmlFor="arrival-w3w" className="block text-sm font-semibold text-slate-900 mb-1">what3words</label>
                    <input id="arrival-w3w" value={w3w} onChange={(e) => setW3w(e.target.value)} placeholder="///harbour.candle.brave" className={inputClass} />
                </EditorPanel>
            )}
        </>
    );
}

// "Directions" — the "last bit" of the journey — on a raised card in the
// editor's Arrival section, the field behind it.
export function DirectionsCard({ listingId }: { listingId: string }) {
    const arrival = useArrival(listingId);
    const [open, setOpen] = useState(false);
    const [dirs, setDirs] = useState('');

    const save = async () => {
        if (await arrival.save({ arrival_directions: dirs })) setOpen(false);
    };

    const summary = !arrival.loaded ? 'Loading…' : (arrival.base.arrival_directions || 'Not added yet');

    return (
        <>
            <EditorCard title="Directions" summary={summary} onClick={() => { if (arrival.loaded) { setDirs(arrival.base.arrival_directions || ''); setOpen(true); } }} />
            {open && (
                <EditorPanel title="Directions" onClose={() => setOpen(false)}
                    footer={
                        <div className="flex items-center justify-end gap-3">
                            {arrival.error && <span className="text-sm text-red-600">{arrival.error}</span>}
                            <PanelSave onClick={save} disabled={arrival.saving} />
                        </div>
                    }>
                    <AutoTextarea id="arrival-directions" aria-label="Directions" value={dirs} onChange={(e) => setDirs(e.target.value)} rows={3}
                        placeholder="Turn at the red postbox, the track is bumpy — park on the gravel by the blue door."
                        className={inputClass} />
                </EditorPanel>
            )}
        </>
    );
}
