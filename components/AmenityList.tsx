'use client';

import { useState } from 'react';

// What a guest actually decides on, best first. A hot tub or a dog-friendly
// cottage is the reason someone books; a smoke alarm is not, however much it
// matters. Anything not named here keeps the order the host chose and falls in
// behind, which is where "Hangers" and "Hot water" belong.
const DECIDES_ON = [
    'Hot tub',
    'Wifi',
    'Free parking on premises',
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

const SHOWN_ON_PHONE = 8;

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

    const hiddenCount = Math.max(0, sorted.length - SHOWN_ON_PHONE);

    return (
        <>
            <div className="flex flex-wrap gap-2">
                {sorted.map((a, i) => (
                    <span
                        key={a}
                        // Beyond the eighth, hidden on a phone until asked for.
                        // A laptop shows the lot, as it always has.
                        className={`text-sm bg-slate-100 px-3 py-1 rounded-full ${
                            i >= SHOWN_ON_PHONE && !open ? 'hidden lg:inline-block' : ''
                        }`}
                    >
                        {a}
                    </span>
                ))}
            </div>

            {hiddenCount > 0 && (
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    className="lg:hidden mt-3 text-sm font-semibold text-slate-900 underline underline-offset-4"
                >
                    {open ? 'Show less' : `Show all ${sorted.length} things this place offers`}
                </button>
            )}
        </>
    );
}
