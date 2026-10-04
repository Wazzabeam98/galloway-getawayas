'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { savePaused, TakenDownBanner, ListingStatusSection, type PauseBilling } from '@/components/services/ListingPauseControl';

// The trade editor's take-down: the same control the experience editor has
// (components/services/ListingPauseControl), placed twice on the server-rendered
// edit page — the strip at the top while it's down, the Listing status section
// at the bottom. State comes from the server props; a press saves and refreshes
// the page, so both places and the "Listed" pill above agree.
export default function TradeListingStatus({ place, providerId, paused, adminHidden, billing }: {
    place: 'banner' | 'section';
    providerId: string;
    paused: boolean;
    adminHidden: boolean;
    billing: PauseBilling;
}) {
    const router = useRouter();
    const [pausing, setPausing] = useState(false);

    async function toggle() {
        setPausing(true);
        const ok = await savePaused(providerId, !paused);
        if (ok) router.refresh();
        setPausing(false);
    }

    return place === 'banner'
        ? <TakenDownBanner paused={paused} adminHidden={adminHidden} pausing={pausing} onPutBack={toggle} who="hosts" billing={billing} />
        : <ListingStatusSection paused={paused} adminHidden={adminHidden} pausing={pausing} onToggle={toggle} who="hosts" billing={billing} />;
}
