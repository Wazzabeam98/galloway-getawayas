'use client';

import { useEffect, useState } from 'react';

// The "Experiences, coming soon" teaser, shown ONCE at the page level.
//
// It used to ride in every trip card's right column (GuestExperiences), so a
// guest with three bookings read the same paragraph three times and it drowned
// the page. The flag it reads (GUEST_EXPERIENCES_OPEN) is global, so the message
// was identical on every card — nothing per-booking about it. While the feature
// is behind that flag this stands in for it, once. When it launches, the
// per-booking panel comes back into the card (see the trips page note).
//
// It checks the flag through the same endpoint the card used — any booking id
// works, because the closed check happens before the booking is looked at.
export default function ExperiencesTeaser({ bookingId }: { bookingId: string }) {
    const [open, setOpen] = useState<boolean | null>(null);

    useEffect(() => {
        let live = true;
        fetch('/api/services/experiences?booking=' + encodeURIComponent(bookingId))
            .then((r) => r.json())
            .then((d) => { if (live) setOpen(d && d.open === true); })
            .catch(() => { if (live) setOpen(true); }); // fail quiet: don't tease if unsure
        return () => { live = false; };
    }, [bookingId]);

    // Only the closed state is a page-level teaser. Open is per-booking and
    // lives in the card, not here.
    if (open !== false) return null;

    return (
        <section className="mt-10 rounded-2xl border border-dashed border-slate-300 p-5">
            <h3 className="text-lg font-semibold text-slate-900">Experiences, coming soon to your stay</h3>
            <p className="mt-1 text-sm text-slate-500">
                Local experiences you’ll be able to book for your dates — a chef, a cake, a sauna, a
                guided walk. We’re lining up businesses now.
            </p>
        </section>
    );
}
