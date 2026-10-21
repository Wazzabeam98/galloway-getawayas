'use client';

import { useEffect, useState } from 'react';
import UpcomingExperience, { type Upcoming } from '@/components/UpcomingExperience';

// Fetches the signed-in guest's upcoming booked experiences (the same
// `upcoming` list /api/services/to-review already serves) and hands them to the
// presentational UpcomingExperience card. Split out so the home page can stay
// edge-cached: the list is per-viewer and read after load, never baked into the
// shared HTML. Renders nothing when there's none — UpcomingExperience self-gates.
export default function UpcomingExperienceLoader() {
    const [list, setList] = useState<Upcoming[]>([]);

    useEffect(() => {
        let live = true;
        fetch('/api/services/to-review', { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d && d.ok) setList((d.upcoming as Upcoming[]) || []); })
            .catch(() => { /* leave it empty */ });
        return () => { live = false; };
    }, []);

    return <UpcomingExperience list={list} />;
}
