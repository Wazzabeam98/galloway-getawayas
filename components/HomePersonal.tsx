'use client';

import { useEffect, useState } from 'react';
import UpcomingTripClient from '@/components/UpcomingTripClient';
import UpcomingExperienceLoader from '@/components/UpcomingExperienceLoader';
import HostReservationsClient from '@/components/HostReservationsClient';

// The home page's per-viewer top block, fetched on the client so the page's
// HTML is the same for everyone and can be edge-cached. It used to be rendered
// on the server from the session cookie — which forced the whole home page
// dynamic and would have put one person's trip (and a confirmed stay's arrival
// secrets) into shared HTML.
//
// It asks /api/nav who the viewer is and which side they're on (the same source
// the navbar reads, so the page agrees with the mode switch). A signed-out
// visitor sees nothing here, exactly as before. In hosting mode it shows the
// next arrivals; otherwise the upcoming trip and any booked experiences. Each
// sub-component fetches its own data and self-gates, rendering nothing when
// there's none — so there's no empty shelf. (The co-host invitation card is a
// separate client component, CohostInvites, already on the page.)

export default function HomePersonal() {
    const [state, setState] = useState<{ signedIn: boolean; mode: 'host' | 'travel' } | null>(null);

    useEffect(() => {
        let live = true;
        fetch('/api/nav', { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!live || !d) return;
                setState({ signedIn: !!d.signedIn, mode: d.mode === 'host' ? 'host' : 'travel' });
            })
            .catch(() => { /* nothing shows */ });
        return () => { live = false; };
    }, []);

    if (!state || !state.signedIn) return null;

    if (state.mode === 'host') return <HostReservationsClient />;

    // The stay leads (it's the anchor of the holiday); a booked experience gets
    // its own peer card below. Each self-gates and renders nothing when there's
    // none — no empty shelf.
    return (
        <>
            <UpcomingTripClient />
            <UpcomingExperienceLoader />
        </>
    );
}
