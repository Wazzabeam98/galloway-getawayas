// The public host profile — everything shown at /hosts/[id], gathered in one
// place so the page stays a thin shell and the privacy rules live somewhere a
// test can point at.
//
// Read entirely through the SERVICE ROLE (adminClient), the same as every other
// public, edge-cached page on the site (the listing page, the experience page).
// Reading the visitor's session would opt the page out of static caching and
// risk a per-viewer copy being cached. So nothing here touches cookies, and the
// shape this returns carries ONLY public fields — a first name, an avatar key, a
// bio, a join year, aggregate review numbers and the host's own published
// listings. A surname, an email, an address, a phone number, a Stripe flag — none
// of those are selected into the return, so none can end up in the cached HTML.
//
// "Their" listings means the ones they OWN: filtered on listings.host_id /
// service_providers.owner_id. A co-hosted listing is reached only through a
// listing_access / provider_access row and is deliberately NOT included — a
// co-host is not the owner, and the profile answers "what does this person let?"
//
// Only publicly visible things appear: a listing must be status='published'
// (not draft, pending or hidden) and an experience must pass the same public
// gates the browse grid uses (approved, a guest audience, not paused, not
// admin-hidden) — reused via loadPublicMarketplace so the two can't drift.

import { adminClient } from '@/lib/supabaseAdmin';
import { hasPublicScore, meanTo2dp } from '@/lib/reviews';
import { hostByline, capitializeFirst, firstName } from '@/lib/utils';
import { loadPublicMarketplace, type MpProvider } from '@/lib/experiencesData';
import { hostResponsiveness, type HostResponsiveness } from '@/lib/hostResponsiveness';
import { areaForListing, areaForTownKey, hasCopy } from '@/config/areas';
import { townOf, townKey } from '@/lib/places';

// The listing-card fields the grid needs. Shaped to match ListingCard's
// CardListing, but declared here rather than imported from that component: this
// is a .ts lib the test typecheck compiles without JSX, so it must not reach
// into a .tsx. The page passes these rows straight to <ListingCard>, which
// re-types them against its own CardListing there.
export type HostListingCard = {
    id: string;
    title: string;
    location: string | null;
    price_per_night: number | string;
    images: string[] | null;
    rating_avg: number | string | null;
    rating_count: number | null;
    amenities?: string[] | null;
    approx_latitude?: number | string | null;
    approx_longitude?: number | string | null;
    property_type?: string | null;
    max_guests?: number | string | null;
    bedrooms?: number | string | null;
    bathrooms?: number | string | null;
    max_pets?: number | string | null;
    is_luxury?: boolean | null;
};

// The anon-safe card columns, the same set the area grid selects — approx
// lat/long only, never the exact point.
const CARD_COLUMNS =
    'id, title, location, price_per_night, images, rating_avg, rating_count, amenities, approx_latitude, approx_longitude, property_type, max_guests, bedrooms, bathrooms, max_pets, display_order, is_luxury, status';

export interface HostReviewItem {
    id: string;
    rating: number;
    comment: string;
    firstName: string;
    // The listing or experience the review was left for, so a guest can see what
    // the host is being praised for — Airbnb shows this too. Never an address.
    itemName: string | null;
    when: string;
}

export interface HostProfile {
    id: string;
    firstName: string;
    avatarUrl: string | null;
    bio: string | null;
    sinceYear: number | null;
    monthsHosting: number | null;
    // The combined review numbers across everything they let. The average is
    // withheld until MIN_PUBLIC_REVIEWS exist (hasPublicScore), exactly as a
    // single listing's score is — a handful of reviews is not a rating.
    ratingCount: number;
    ratingAvg: number | null;
    listings: HostListingCard[];
    experiences: MpProvider[];
    reviews: HostReviewItem[];
    // Airbnb's "confirmed information", from what we actually hold: the same
    // Verified host badge the listing page shows (Stripe has confirmed their
    // identity and bank), as a boolean — the Stripe flag itself never leaves.
    verified: boolean;
    // The same response rate and reply time the listing page's host card shows.
    responsiveness: HostResponsiveness;
    // Where they host, one entry per area or town, linked to the area page
    // when there is a written one — the internal links a crawler follows from
    // a profile out to the rest of the site.
    places: { name: string; href: string | null }[];
}

// Whole months between a join date and now — the same reckoning the listing
// page's host card uses (shave a month if we haven't reached the join
// day-of-month yet, so a partial month doesn't round up).
function monthsSince(created: string | null): { sinceYear: number | null; monthsHosting: number | null } {
    if (!created) return { sinceYear: null, monthsHosting: null };
    const d = new Date(created);
    if (isNaN(d.getTime())) return { sinceYear: null, monthsHosting: null };
    const now = new Date();
    let m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (now.getDate() < d.getDate()) m -= 1;
    return { sinceYear: d.getFullYear(), monthsHosting: Math.max(0, m) };
}

// Returns null when there is no public profile to show — the person doesn't
// exist, their account has been anonymised or deactivated, or they own nothing
// published. The page turns a null into a 404, so a cached copy of a profile
// with nothing public is never created and nobody's private details sit behind
// a URL that resolves.
export async function loadHostProfile(hostId: string): Promise<HostProfile | null> {
    const admin = adminClient();

    // The name columns are read ONLY to resolve the display first name on the
    // server; the surname never leaves this function. stripe/contact/address
    // columns are not selected at all.
    const { data: profile } = await admin
        .from('profiles')
        .select('id, first_name, last_name, preferred_name, show_full_name, trading_name, full_name, avatar_url, created_at, host_bio, stripe_payouts_enabled, anonymised_at, deactivated_at')
        .eq('id', hostId)
        .maybeSingle();

    if (!profile) return null;
    // A ghost or closed account has no public face — the same guard the listing
    // page applies to a listing whose host has gone.
    if (profile.anonymised_at || profile.deactivated_at) return null;

    const byline = hostByline(profile, null, 'Host');
    const displayFirstName = byline === 'Host' ? 'Host' : capitializeFirst(byline);

    // Their published holiday lets — owned, not co-hosted (host_id equality), and
    // only the publicly visible status. Ordered the way the host arranged them.
    const { data: listingRows } = await admin
        .from('listings')
        .select(CARD_COLUMNS)
        .eq('host_id', hostId)
        .eq('status', 'published')
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
    const listings = (listingRows || []) as unknown as HostListingCard[];

    // Their approved experiences — owned (owner_id), filtered out of the full
    // public marketplace so every eligibility and privacy gate is the browse
    // grid's, not a second copy of it.
    const marketplace = await loadPublicMarketplace(admin, true);
    const experiences = (marketplace.providers || []).filter((p) => p.ownerId === hostId);

    const { sinceYear, monthsHosting } = monthsSince(profile.created_at);

    // Nothing published to show, and no link anywhere points here — treat it as
    // no public profile rather than render an empty page.
    if (listings.length === 0 && experiences.length === 0) return null;

    // The reviews behind everything they let: guest→host for the published
    // listings, guest→provider for the experiences. Only published, un-hidden
    // reviews — hidden_at is the single takedown lever every public read respects.
    const listingIds = listings.map((l) => l.id);
    const providerIds = experiences.map((p) => p.id);

    type RawReview = {
        id: string;
        reviewer_id: string;
        rating: number;
        comment: string;
        created_at: string;
        listing_id: string | null;
        provider_id: string | null;
    };
    let raw: RawReview[] = [];

    if (listingIds.length) {
        const { data } = await admin
            .from('reviews')
            .select('id, reviewer_id, rating, comment, created_at, listing_id, provider_id')
            .in('listing_id', listingIds)
            .eq('review_type', 'guest_to_host')
            .eq('is_published', true)
            .is('hidden_at', null);
        raw = raw.concat((data || []) as RawReview[]);
    }
    if (providerIds.length) {
        const { data } = await admin
            .from('reviews')
            .select('id, reviewer_id, rating, comment, created_at, listing_id, provider_id')
            .in('provider_id', providerIds)
            .eq('review_type', 'guest_to_provider')
            .eq('is_published', true)
            .is('hidden_at', null);
        raw = raw.concat((data || []) as RawReview[]);
    }

    // Most recent first, like Airbnb's profile reviews.
    raw.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Reviewer first names, resolved server-side (the name columns aren't anon
    // readable) — first name only, same as every other review surface.
    const reviewerIds = Array.from(new Set(raw.map((r) => r.reviewer_id).filter(Boolean)));
    const nameById = new Map<string, string>();
    if (reviewerIds.length) {
        const { data: reviewers } = await admin
            .from('profiles')
            .select('id, first_name, last_name, preferred_name, show_full_name, full_name')
            .in('id', reviewerIds);
        (reviewers || []).forEach((p: any) => nameById.set(p.id, capitializeFirst(firstName(p, 'Guest'))));
    }

    // What each review was left for — a listing title or an experience's
    // business name. Both are already public (they're the card headings).
    const titleByListing = new Map(listings.map((l) => [l.id, l.title]));
    const nameByProvider = new Map(experiences.map((p) => [p.id, p.business_name]));

    const reviews: HostReviewItem[] = raw.map((r) => ({
        id: r.id,
        rating: Number(r.rating),
        comment: r.comment,
        firstName: nameById.get(r.reviewer_id) || 'Guest',
        itemName:
            (r.listing_id && titleByListing.get(r.listing_id)) ||
            (r.provider_id && nameByProvider.get(r.provider_id)) ||
            null,
        when: r.created_at,
    }));

    // Where they host. An area with written copy links to its page; anywhere
    // else is just the town's name. Listings by town or (Galloway Forest) by
    // coordinates; experiences by the town they're based in.
    const places: { name: string; href: string | null }[] = [];
    const seenPlace = new Set<string>();
    const addPlace = (name: string, href: string | null) => {
        const key = name.toLowerCase();
        if (!name || seenPlace.has(key)) return;
        seenPlace.add(key);
        places.push({ name, href });
    };
    listings.forEach((l) => {
        const area = areaForListing(l);
        if (area && hasCopy(area) && !area.hold) addPlace(area.name, `/holiday-cottages/${area.slug}`);
        else addPlace(townOf(l.location), null);
    });
    experiences.forEach((p) => {
        if (!p.based_line) return;
        const area = areaForTownKey(townKey(p.based_line));
        if (area && hasCopy(area) && !area.hold) addPlace(area.name, `/holiday-cottages/${area.slug}`);
        else addPlace(townOf(p.based_line), null);
    });

    const responsiveness = await hostResponsiveness(admin, hostId);

    const ratings = raw.map((r) => Number(r.rating));
    const ratingCount = ratings.length;
    const ratingAvg = hasPublicScore(ratingCount) ? meanTo2dp(ratings) : null;

    return {
        id: hostId,
        firstName: displayFirstName,
        avatarUrl: profile.avatar_url || null,
        bio: (profile.host_bio || '').trim() || null,
        sinceYear,
        monthsHosting,
        ratingCount,
        ratingAvg,
        listings,
        experiences,
        reviews,
        verified: profile.stripe_payouts_enabled === true,
        responsiveness,
        places,
    };
}
