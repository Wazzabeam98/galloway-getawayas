import { revalidatePath, revalidateTag } from 'next/cache';

// One place that refreshes the edge-cached public pages the moment something
// behind them changes, so an edit shows at once instead of waiting for the 300s
// background rebuild. The write routes call these right after a successful write.
//
// revalidateTag busts the home page's unstable_cache blocks (the 'listings' and
// 'home' tagged reads in app/page.tsx and components/HomeExperiences);
// revalidatePath refreshes the ISR pages themselves — the listing page, every
// area page (the dynamic '/holiday-cottages/[area]' segment), the experiences
// grid and a given experience page, and the home page.
//
// Best-effort: a revalidation must NEVER fail the write it follows (a booking, a
// payout, an approval). Everything is wrapped so a throw here is swallowed.

function safe(fn: () => void) {
    try {
        fn();
    } catch {
        /* revalidation is a cache hint, never load-bearing */
    }
}

// A published cottage changed — created, edited, published, approved, hidden,
// deleted, repriced, or its calendar/availability moved. Pass the id to refresh
// that listing's own page too; omit it (e.g. an Arrange reorder) to refresh just
// the grids.
export function revalidateListing(listingId?: string) {
    safe(() => {
        revalidateTag('listings');
        revalidateTag('home');
        revalidatePath('/');
        revalidatePath('/holiday-cottages/[area]', 'page');
        if (listingId) revalidatePath(`/homes/${listingId}`);
    });
}

// Several listings at once (an admin approve-batch, an iCal cron pass). De-duped
// so the grids are only busted once.
export function revalidateListings(listingIds: string[]) {
    safe(() => {
        revalidateTag('listings');
        revalidateTag('home');
        revalidatePath('/');
        revalidatePath('/holiday-cottages/[area]', 'page');
        for (const id of Array.from(new Set(listingIds)).filter(Boolean)) {
            revalidatePath(`/homes/${id}`);
        }
    });
}

// An experience provider changed — approved, edited, paused, taken down,
// relisted, or reordered. Pass the id to refresh that experience's own page too.
export function revalidateExperience(providerId?: string) {
    safe(() => {
        revalidateTag('home');
        revalidatePath('/');
        revalidatePath('/experiences/browse');
        if (providerId) revalidatePath(`/experiences/browse/${providerId}`);
    });
}
