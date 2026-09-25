'use client';

import { useEffect, useRef, useState } from 'react';
import { AddressParts, EMPTY_ADDRESS, composeAddressLine } from '@/lib/address';

// The address value shape and its composed line live in lib/address (pure and
// testable); re-exported here so the modal and basket import them from the
// widget they use.
export type { AddressParts };
export { EMPTY_ADDRESS, composeAddressLine };

// A reusable Ideal-Postcodes address lookup + hand-entry fields, lifted from the
// provider collection screen so guests and providers share one address widget
// rather than two that drift. The search-as-you-type, the D&G region gate and the
// "enter it by hand" escape all behave exactly as they do in the sign-up wizard;
// only the labels are tuned for a guest entering a DELIVERY address.
//
// The two /api/address routes need a signed-in user (each call spends a paid
// lookup), so an anonymous booker is given the hand-entry fields straight away
// (searchEnabled=false) — the fields always work without the lookup.
//
// Controlled: the parent owns the AddressParts and the "have they tried to save
// yet" flag, so validation messages appear only on Save (showErrors), never while
// typing.
export default function AddressLookup({
    value, onChange, searchEnabled, showErrors,
}: {
    value: AddressParts;
    onChange: (next: AddressParts) => void;
    searchEnabled: boolean;
    showErrors: boolean;
}) {
    // Fields mode once anything is filled (a picked or hand-typed address is a
    // settled answer, not a search term), or whenever search is off.
    const hasAny = !!(value.house || value.street || value.town || value.postcode);
    const [manual, setManual] = useState(!searchEnabled || hasAny);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<{ id: string; label: string }[]>([]);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const seq = useRef(0);

    const inLookupMode = searchEnabled && !manual && !hasAny;

    const set = (patch: Partial<AddressParts>) => onChange({ ...value, ...patch });

    // Search-as-you-type: debounce the query and fire once it settles (≥3 chars).
    // A `seq` guard drops an earlier response that resolves after a later one.
    useEffect(() => {
        if (!inLookupMode) return;
        const q = query.trim();
        if (q.length < 3) { setResults([]); return; }
        const timer = setTimeout(async () => {
            const mine = ++seq.current;
            setBusy(true); setNotice('');
            try {
                const res = await fetch('/api/address/autocomplete?q=' + encodeURIComponent(q));
                const body = await res.json();
                if (mine !== seq.current) return;
                if (!res.ok || !body.ok) {
                    setNotice('We can’t search addresses just now — enter it by hand below.');
                    setResults([]);
                    return;
                }
                const list = (body.suggestions || []).map((s: any) => ({ id: String(s.id), label: String(s.address || '') }));
                setNotice(list.length ? '' : 'No matches — enter it by hand below.');
                setResults(list);
            } catch {
                if (mine !== seq.current) return;
                setNotice('We can’t search addresses just now — enter it by hand below.');
                setResults([]);
            } finally {
                if (mine === seq.current) setBusy(false);
            }
        }, 300);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, inLookupMode]);

    const pick = async (id: string) => {
        setBusy(true); setNotice('');
        try {
            const res = await fetch('/api/address/get?id=' + encodeURIComponent(id));
            const body = await res.json();
            // Real, but outside Dumfries & Galloway — say where, and DON'T fill.
            if (body && body.outOfRegion) {
                setNotice((body.district
                    ? 'That address is in ' + body.district + ', outside Dumfries & Galloway.'
                    : 'That address is outside Dumfries & Galloway.') + ' Pick another, or enter it by hand.');
                setResults([]);
                return;
            }
            if (!res.ok || !body.ok || !body.address) {
                setNotice('We couldn’t load that address — enter it by hand below.');
                return;
            }
            const a = body.address;
            onChange({
                house: a.flat || '',
                street: a.street || '',
                town: a.town || '',
                postcode: a.postcode || '',
            });
            setResults([]); setNotice(''); setQuery(''); setManual(true);
        } catch {
            setNotice('We couldn’t load that address — enter it by hand below.');
        } finally {
            setBusy(false);
        }
    };

    const searchAgain = () => {
        onChange(EMPTY_ADDRESS);
        setManual(false); setQuery(''); setResults([]); setNotice('');
    };

    const postcodeMissing = showErrors && !value.postcode.trim();
    const streetMissing = showErrors && !value.street.trim() && !value.house.trim();

    return (
        <div>
            {inLookupMode ? (
                <>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Search your address</label>
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Start typing a postcode or street"
                        autoComplete="off"
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    {busy && results.length === 0 && <p className="mt-2 text-xs text-slate-400">Searching…</p>}
                    {results.length > 0 && (
                        <>
                            <p className="mt-2 text-xs text-slate-400">{results.length} {results.length === 1 ? 'address' : 'addresses'}</p>
                            <ul className="scroll-always mt-1 max-h-56 overflow-y-auto overscroll-contain rounded-xl border border-slate-200 divide-y divide-slate-100">
                                {results.map((s) => (
                                    <li key={s.id}>
                                        <button type="button" onClick={() => pick(s.id)}
                                            className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 transition hover:bg-emerald-50">
                                            {s.label}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                    {notice && <p className="mt-2 text-xs text-slate-500">{notice}</p>}
                    <button type="button" onClick={() => setManual(true)}
                        className="mt-3 text-sm font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800">
                        Enter it by hand
                    </button>
                </>
            ) : (
                <>
                    <div className="space-y-3">
                        <div>
                            <label htmlFor="da-house" className="block text-xs font-medium text-slate-500 mb-1">House name or flat <span className="font-normal text-slate-400">(if any)</span></label>
                            <input id="da-house" type="text" value={value.house}
                                onChange={(e) => set({ house: e.target.value.slice(0, 120) })}
                                placeholder="e.g. Rose Cottage, or Flat 2"
                                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700" />
                        </div>
                        <div>
                            <label htmlFor="da-street" className="block text-xs font-medium text-slate-500 mb-1">Street</label>
                            <input id="da-street" type="text" value={value.street}
                                onChange={(e) => set({ street: e.target.value.slice(0, 200) })}
                                placeholder="e.g. 18 Dovecroft"
                                className={`w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700 ${streetMissing ? 'border-rose-400' : 'border-slate-300'}`} />
                        </div>
                        <div className="flex gap-3">
                            <div className="min-w-0 flex-1">
                                <label htmlFor="da-town" className="block text-xs font-medium text-slate-500 mb-1">Town</label>
                                <input id="da-town" type="text" value={value.town}
                                    onChange={(e) => set({ town: e.target.value.slice(0, 120) })}
                                    placeholder="e.g. Kirkcudbright"
                                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700" />
                            </div>
                            <div className="w-36 flex-none">
                                <label htmlFor="da-postcode" className="block text-xs font-medium text-slate-500 mb-1">Postcode</label>
                                <input id="da-postcode" type="text" value={value.postcode}
                                    onChange={(e) => set({ postcode: e.target.value.slice(0, 20) })}
                                    placeholder="DG6 4JA"
                                    className={`w-full rounded-xl border px-4 py-3 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-emerald-700 ${postcodeMissing ? 'border-rose-400' : 'border-slate-300'}`} />
                            </div>
                        </div>
                    </div>
                    {(postcodeMissing || streetMissing) && (
                        <p className="mt-2 text-sm text-rose-700">
                            {postcodeMissing ? 'A postcode is needed so they know where to deliver.' : 'Add a street or house name.'}
                        </p>
                    )}
                    {searchEnabled && (
                        <button type="button" onClick={searchAgain}
                            className="mt-2 text-sm font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800">
                            Search for it instead
                        </button>
                    )}
                </>
            )}
        </div>
    );
}
