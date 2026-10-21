'use client';

import React, { useEffect, useState } from 'react';
import PropertyMap from '@/components/PropertyMap';

// The booked-stay page shows its map in one of two places: the sticky side
// column on desktop, or inside "Where you'll be" (above the address) on a
// phone, where the listing photo leads the page instead — Airbnb's trip page.
// Both slots are in the markup, hidden by CSS at the other width, but only the
// one that is showing mounts a map, so a page never loads Mapbox twice.
const DESKTOP = '(min-width: 1024px)';

export default function TripMap({
    placement,
    latitude,
    longitude,
    area,
    pinImage,
}: {
    placement: 'side' | 'inline';
    latitude: number;
    longitude: number;
    area?: string;
    pinImage?: string | null;
}) {
    const [desktop, setDesktop] = useState<boolean | null>(null);
    useEffect(() => {
        const mq = window.matchMedia(DESKTOP);
        const update = () => setDesktop(mq.matches);
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, []);

    const side = placement === 'side';
    const mounted = desktop !== null && desktop === side;
    const frame = side ? 'h-[620px]' : 'h-[200px]';

    return (
        <div className={side ? 'hidden lg:block' : 'mt-3 lg:hidden'}>
            {mounted ? (
                <PropertyMap
                    latitude={latitude}
                    longitude={longitude}
                    area={area}
                    variant="card"
                    pinImage={pinImage}
                    frameClassName={frame}
                />
            ) : (
                <div className={`${frame} w-full rounded-2xl bg-slate-100`} />
            )}
        </div>
    );
}
