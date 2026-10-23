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

// Just one listing's own page — a change that shows only there (a review taken
// down or put back).
export function revalidateListingPage(listingId: string | null | undefined) {
    if (!listingId) return;
    safe(() => {
        revalidatePath(`/homes/${listingId}`);
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
    revalidateExperiences(providerId ? [providerId] : []);
}

// Several providers at once (an admin approve-batch). The grids are busted once,
// then each provider's own page — which matters for an approval in particular:
// before it, the page's cached copy is just a redirect to the per-request owner
// preview, and it must become the real page the moment the provider goes live.
export function revalidateExperiences(providerIds: string[]) {
    safe(() => {
        revalidateTag('home');
        revalidatePath('/');
        revalidatePath('/experiences/browse');
        for (const id of Array.from(new Set(providerIds)).filter(Boolean)) {
            revalidatePath(`/experiences/browse/${id}`);
        }
    });
}

// A host's public profile page (/hosts/[id]) — refreshed when anything it shows
// changes: the host edits their profile (name, photo, bio), or one of their
// listings/experiences is saved, published, repriced, hidden or reviewed (which
// moves the grid and the combined review score on the profile). Pass the host's
// user id. 300s is the background fallback for anything that doesn't call this.
export function revalidateHostProfile(hostId: string | null | undefined) {
    if (!hostId) return;
    safe(() => {
        revalidatePath(`/hosts/${hostId}`);
    });
}

// Just one experience's own page — for a change that shows on that page but not
// on the grids or the home shelf: its calendar (hours, day-offs, part-day blocks,
// declared sessions, an imported busy feed) or its reviews. Seat counts are
// fetched live by the page's booking panel anyway (/api/experiences/[id]/live),
// so this keeps the first paint right rather than being the only guard.
export function revalidateExperiencePage(providerId: string | null | undefined) {
    if (!providerId) return;
    safe(() => {
        revalidatePath(`/experiences/browse/${providerId}`);
    });
}
