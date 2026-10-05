'use client';

import { useState } from 'react';
import { toast } from 'react-toastify';
import { ChevronDown } from 'lucide-react';
import { PLOT_BANDS, STOREY_BANDS } from '@/lib/serviceProviders';

// The two facts a gardener or a window cleaner needs before they can price a
// visit — how big the garden is and how high the windows go. Nothing on a
// listing says either, so the host is asked once and every trade quotes from
// it. They lived in the holiday-let editor's Basics until the editor was
// rebuilt on Airbnb's lines (5 October 2026); a guest never sees them, so they
// belong here, beside the trades that use them.
//
// Both optional: a blank one means that trade cannot quote for the place yet,
// which is a prompt when they first look, not a blocked save. Saved through
// /api/listings/save, the same door as the editor, so a co-host the owner
// trusted with the listing can answer them too.

type Listing = { id: string; title: string | null; plot_band: string | null; storey_band: string | null };

// One choice from three. Radio-style buttons rather than a <select>: the
// options are sentences, and a dropdown hides two of the three at the moment
// somebody is choosing between them. "Not said" stays reachable — tap the
// chosen one again to clear it.
function BandChoice({
    label,
    options,
    value,
    onChange,
}: {
    label: string;
    options: readonly { key: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div>
            <div className="text-sm font-semibold text-slate-900 mb-2">{label}</div>
            <div className="space-y-2">
                {options.map((o) => {
                    const on = value === o.key;
                    return (
                        <button
                            key={o.key}
                            type="button"
                            onClick={() => onChange(on ? '' : o.key)}
                            aria-pressed={on}
                            className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition ${
                                on
                                    ? 'border-emerald-700 ring-2 ring-emerald-700 bg-emerald-50 text-slate-900'
                                    : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
                            }`}
                        >
                            {o.label}
                        </button>
                    );
                })}
            </div>
            {!value && (
                <p className="text-xs text-slate-500 mt-2">
                    Not said yet. They cannot price a visit here until you pick one.
                </p>
            )}
        </div>
    );
}

function ListingBands({ listing }: { listing: Listing }) {
    const [open, setOpen] = useState(false);
    const [plot, setPlot] = useState(listing.plot_band || '');
    const [storey, setStorey] = useState(listing.storey_band || '');
    const [saved, setSaved] = useState({ plot: listing.plot_band || '', storey: listing.storey_band || '' });
    const [saving, setSaving] = useState(false);

    const answered = [saved.plot, saved.storey].filter(Boolean).length;
    const dirty = plot !== saved.plot || storey !== saved.storey;

    async function save() {
        setSaving(true);
        try {
            const res = await fetch('/api/listings/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listingId: listing.id, patch: { plot_band: plot || null, storey_band: storey || null } }),
            });
            const d = await res.json();
            if (d && d.ok) {
                setSaved({ plot, storey });
                toast.success('Saved.', { theme: 'colored' });
            } else {
                toast.error((d && d.error) || 'Could not save.', { theme: 'colored' });
            }
        } catch {
            toast.error('Could not save.', { theme: 'colored' });
        }
        setSaving(false);
    }

    return (
        <div className="border-t border-slate-200 first:border-t-0">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
            >
                <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-900">{listing.title || 'Untitled listing'}</span>
                    <span className={`block text-sm ${answered === 2 ? 'text-slate-500' : 'text-amber-700'}`}>
                        {answered === 2 ? 'Garden and windows answered' : answered === 1 ? '1 of 2 answered' : 'Not answered yet'}
                    </span>
                </span>
                <ChevronDown className={`h-5 w-5 flex-none text-slate-500 transition ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="space-y-6 px-5 pb-5">
                    <BandChoice label="The garden or grounds" options={PLOT_BANDS} value={plot} onChange={setPlot} />
                    <BandChoice label="How high the windows go" options={STOREY_BANDS} value={storey} onChange={setStorey} />
                    <button
                        type="button"
                        onClick={save}
                        disabled={saving || !dirty}
                        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
                    >
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            )}
        </div>
    );
}

export default function PropertyServiceDetails({ listings }: { listings: Listing[] }) {
    if (!listings.length) return null;
    return (
        <section className="mt-8">
            <h2 className="text-lg font-bold text-slate-900">Your property, for tradespeople</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Two things a gardener or window cleaner needs before they can price a visit. Answer
                once for each place and they all quote from it. Guests never see these.
            </p>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {listings.map((l) => <ListingBands key={l.id} listing={l} />)}
            </div>
        </section>
    );
}
