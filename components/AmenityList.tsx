'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { amenityIcon } from '@/lib/amenityIcons';
import { groupAmenities } from '@/lib/amenityGroups';

// What a guest actually decides on, best first. A hot tub or a dog-friendly
// cottage is the reason someone books; a smoke alarm is not, however much it
// matters. Anything not named here keeps the order the host chose and falls in
// behind, which is where "Hangers" and "Hot water" belong.
const DECIDES_ON = [
    'Hot tub',
    'Wifi',
    'Free parking on premises',
    'Free street parking',
    'Pets allowed',
    'Pool',
    'Waterfront',
    'Beach access',
    'Indoor fireplace',
    'EV charger',
    'Dedicated workspace',
    'Kitchen',
    'Washing machine',
    'Cot',
    'Gym',
    'Outdoor furniture',
    'TV',
    'Heating',
];

// Airbnb shows ten on the page and the rest behind "Show all". Two columns of
// five reads as a block on desktop; on a phone it's a single column, so ten runs
// too long — there we show five, as Airbnb does on a phone.
const SHOWN = 10;
const PHONE_SHOWN = 5;

function Row({ name, display = 'flex' }: { name: string; display?: string }) {
    const Icon = amenityIcon(name);
    return (
        <div className={`${display} items-center gap-4 py-3.5 border-b border-slate-100`}>
            <Icon className="h-6 w-6 flex-none text-slate-700" strokeWidth={1.5} />
            <span className="text-[15px] text-slate-800">{name}</span>
        </div>
    );
}

export default function AmenityList({ amenities }: { amenities: string[] }) {
    const [open, setOpen] = useState(false);

    const rank = (a: string) => {
        const i = DECIDES_ON.indexOf(a);
        return i === -1 ? DECIDES_ON.length : i;
    };

    // Stable: equal ranks keep the host's own order.
    const sorted = amenities
        .map((a, i) => ({ a, i }))
        .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
        .map((x) => x.a);

    const shown = sorted.slice(0, SHOWN);
    // The button appears whenever something is hidden: beyond 5 on a phone,
    // beyond 10 on desktop. When it's only the phone that's over its limit
    // (6–10 amenities) the button is phone-only, since desktop shows them all.
    const moreThanPhone = sorted.length > PHONE_SHOWN;
    const moreThanDesktop = sorted.length > SHOWN;

    // Lock the background scroll while the full-list modal is open, and let Esc
    // close it — the small courtesies that make a dialog feel built-in.
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = prev;
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10">
                {shown.map((a, i) => (
                    <Row key={a} name={a} display={i >= PHONE_SHOWN ? 'hidden sm:flex' : 'flex'} />
                ))}
            </div>

            {moreThanPhone && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className={
                        'mt-6 inline-flex items-center justify-center min-h-[48px] rounded-xl border border-slate-800 px-6 text-sm font-semibold text-slate-900 hover:bg-slate-50 transition'
                        + (moreThanDesktop ? '' : ' sm:hidden')
                    }
                >
                    Show all {sorted.length} amenities
                </button>
            )}

            {open && (
                <div
                    className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
                    onClick={() => setOpen(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label="What this place offers"
                >
                    <div
                        className="relative w-full max-w-2xl rounded-2xl bg-white shadow-xl mt-6 sm:mt-12"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="sticky top-0 flex items-center justify-between rounded-t-2xl border-b border-slate-100 bg-white px-6 py-4">
                            <h3 className="text-lg font-semibold text-slate-900">What this place offers</h3>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                aria-label="Close"
                                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-slate-100"
                            >
                                <X className="h-5 w-5 text-slate-700" />
                            </button>
                        </div>
                        <div className="px-6 pb-6 pt-1">
                            {/* Grouped by category — Bathroom, Bedroom and laundry,
                                … — the way Airbnb's full list reads. */}
                            {groupAmenities(amenities).map((group) => (
                                <div key={group.label} className="mt-6 first:mt-2">
                                    <h4 className="text-base font-semibold text-slate-900">{group.label}</h4>
                                    <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-10">
                                        {group.items.map((a) => (
                                            <Row key={a} name={a} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
