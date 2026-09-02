'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, Check } from 'lucide-react';

// The host-facing editor for a listing's arrival details — the "last bit"
// directions, parking, wifi, what3words. Every field is independently optional
// (a host can fill in parking alone and save it), and none of it goes into
// publish validation. The door code sits beside this, edited by LockboxCode
// through its own secure route. Reads and writes go through /api/listings/arrival,
// which gates on can_listing and is the only door to the grant-less table.
export default function ArrivalEditor({ listingId }: { listingId: string }) {
    const [loaded, setLoaded] = useState(false);
    const [dirs, setDirs] = useState('');
    const [parking, setParking] = useState('');
    const [wifiName, setWifiName] = useState('');
    const [wifiPw, setWifiPw] = useState('');
    const [w3w, setW3w] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        fetch('/api/listings/arrival?listing=' + encodeURIComponent(listingId))
            .then((r) => r.json())
            .then((d) => {
                const a = (d && d.arrival) || {};
                setDirs(a.arrival_directions || '');
                setParking(a.parking_info || '');
                setWifiName(a.wifi_name || '');
                setWifiPw(a.wifi_password || '');
                setW3w(a.what3words || '');
                setLoaded(true);
            })
            .catch(() => setLoaded(true));
    }, [listingId]);

    async function save() {
        setSaving(true); setError(''); setSaved(false);
        try {
            const res = await fetch('/api/listings/arrival', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    listingId,
                    arrival_directions: dirs,
                    parking_info: parking,
                    wifi_name: wifiName,
                    wifi_password: wifiPw,
                    what3words: w3w,
                }),
            });
            const d = await res.json();
            if (d && d.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
            else setError((d && d.error) || 'Could not save.');
        } catch { setError('Could not save.'); }
        setSaving(false);
    }

    const inputClass = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700';

    if (!loaded) return <div className="text-sm text-slate-400">Loading…</div>;

    return (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-semibold text-slate-900 mb-1">The last bit of the journey</label>
                <p className="text-xs text-slate-500 mb-1.5">What sat-nav gets wrong — the turn it misses, the track, the door to look for. Your own words beat any form.</p>
                <textarea value={dirs} onChange={(e) => setDirs(e.target.value)} rows={3}
                    placeholder="Turn at the red postbox, the track is bumpy — park on the gravel by the blue door."
                    className={inputClass} />
            </div>

            <div>
                <label className="block text-sm font-semibold text-slate-900 mb-1">Parking</label>
                <input value={parking} onChange={(e) => setParking(e.target.value)} placeholder="Space for two cars on the gravel" className={inputClass} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-1">Wifi network</label>
                    <input value={wifiName} onChange={(e) => setWifiName(e.target.value)} placeholder="HarbourCottage" className={inputClass} />
                </div>
                <div>
                    <label className="block text-sm font-semibold text-slate-900 mb-1">Wifi password</label>
                    <div className="relative">
                        <input type={showPw ? 'text' : 'password'} value={wifiPw} onChange={(e) => setWifiPw(e.target.value)} className={inputClass + ' pr-10'} />
                        <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label={showPw ? 'Hide password' : 'Show password'}>
                            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                    </div>
                </div>
            </div>

            <div>
                <label className="block text-sm font-semibold text-slate-900 mb-1">what3words</label>
                <input value={w3w} onChange={(e) => setW3w(e.target.value)} placeholder="///harbour.candle.brave" className={inputClass + ' sm:max-w-xs'} />
            </div>

            <div className="flex items-center gap-3">
                <button type="button" onClick={save} disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
                    {saved ? 'Saved' : 'Save arrival details'}
                </button>
                {error && <span className="text-sm text-red-600">{error}</span>}
            </div>

            <p className="text-xs text-slate-400">
                Every field is optional and none of it affects publishing. Guests see it on their Getting-there screen; the wifi password and the door code only show there, close to arrival.
            </p>
        </div>
    );
}
