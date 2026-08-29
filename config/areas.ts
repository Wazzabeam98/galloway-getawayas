// The area landing pages: /holiday-cottages/<slug>
//
// WHAT THESE ARE FOR
//
// Somebody typing "holiday cottages in Kirkcudbright" has already decided to
// come to Dumfries & Galloway. They are choosing where, not whether. It is the
// cheapest traffic this site will ever get, and the only search term a
// ten-property site can realistically win against Sykes and Cottages.com,
// because those sites have one thin generated page per town that nobody who
// has been to the place ever read.
//
// There is a second reason, which is about shape rather than traffic. Before
// these pages existed, nothing linked to a listing except the home page grid,
// and a listing linked to nothing at all. Every property was a dead end. These
// give the site a middle layer — home → area → listing, with the listing
// linking back up — which is a shape Google can follow.
//
// THE COPY IS DELIBERATELY EMPTY, AND THAT IS WHAT GATES THE PAGE
//
// `intro` is the two or three paragraphs about the town that are the entire
// point of the page. Until it is written, the area is NOT in the sitemap and
// the page says noindex — see isPublishable() below. A set of thin,
// near-identical auto-generated pages is a quality signal against the whole
// site, so an unwritten page must not be able to reach Google by accident.
//
// AREA-BRIEF.md says what each one needs to say and roughly how long.
//
// HOW A LISTING JOINS AN AREA
//
// By `townKeys`, matched against townKey(listing.location) from lib/places.ts
// — the same function the home page search and the passport already use, so
// an area agrees with them about what counts as the same town however the host
// typed the address. More than one key per area is allowed on purpose: a
// village with no stock of its own belongs on its nearest town's page rather
// than on a page of its own.

export interface Area {
    /** The URL: /holiday-cottages/<slug>. Never change one that is live. */
    slug: string;

    /** "Kirkcudbright". Used in the h1, the title and the breadcrumb. */
    name: string;

    /**
     * townKey() values that belong to this area. Lower case, letters only —
     * townKey strips everything else, so "Gatehouse of Fleet" is
     * "gatehouseoffleet".
     */
    townKeys: string[];

    /**
     * The page's own two or three paragraphs. EMPTY MEANS NOT PUBLISHED.
     * One string per paragraph. See AREA-BRIEF.md.
     */
    intro: string[];

    /**
     * A one-line description for search results and link previews, 150–160
     * characters. Empty falls back to a generated line, which is fine for a
     * page that is noindex anyway and not good enough for one that is not.
     */
    metaDescription: string;

    /**
     * "Half an hour from X, an hour from Y." Optional, and one of the first
     * things people actually search for.
     */
    gettingThere: string[];

    /** Short questions and answers. These are what win the answer box. */
    faqs: { question: string; answer: string }[];

    /** Slugs of the areas worth linking to from this one. Usually neighbours. */
    nearby: string[];
}

// ORDER MATTERS: this is the order they appear in the footer and on the home
// page, so the towns with stock come first.
export const AREAS: Area[] = [
    {
        slug: 'kirkcudbright',
        name: 'Kirkcudbright',
        townKeys: ['kirkcudbright'],
        intro: [],
        metaDescription: '',
        gettingThere: [],
        faqs: [],
        nearby: ['castle-douglas', 'gatehouse-of-fleet', 'dalbeattie'],
    },
    {
        slug: 'castle-douglas',
        name: 'Castle Douglas',
        townKeys: ['castledouglas'],
        intro: [],
        metaDescription: '',
        gettingThere: [],
        faqs: [],
        nearby: ['kirkcudbright', 'dalbeattie', 'dumfries'],
    },
    {
        slug: 'gatehouse-of-fleet',
        name: 'Gatehouse of Fleet',
        townKeys: ['gatehouseoffleet'],
        intro: [],
        metaDescription: '',
        gettingThere: [],
        faqs: [],
        nearby: ['kirkcudbright', 'newton-stewart'],
    },
    {
        slug: 'dalbeattie',
        name: 'Dalbeattie',
        townKeys: ['dalbeattie'],
        intro: [],
        metaDescription: '',
        gettingThere: [],
        faqs: [],
        nearby: ['castle-douglas', 'kirkcudbright', 'dumfries'],
    },
    {
        slug: 'newton-stewart',
        name: 'Newton Stewart',
        townKeys: ['newtonstewart'],
        intro: [],
        metaDescription: '',
        gettingThere: [],
        faqs: [],
        nearby: ['gatehouse-of-fleet', 'wigtown'],
    },
    {
        slug: 'wigtown',
        name: 'Wigtown',
        townKeys: ['wigtown'],
        intro: [],
        metaDescription: '',
        gettingThere: [],
        faqs: [],
        nearby: ['newton-stewart', 'gatehouse-of-fleet'],
    },
    {
        slug: 'dumfries',
        name: 'Dumfries',
        townKeys: ['dumfries'],
        intro: [],
        metaDescription: '',
        gettingThere: [],
        faqs: [],
        nearby: ['castle-douglas', 'dalbeattie', 'moffat'],
    },
    {
        slug: 'moffat',
        name: 'Moffat',
        townKeys: ['moffat'],
        intro: [],
        metaDescription: '',
        gettingThere: [],
        faqs: [],
        nearby: ['dumfries'],
    },
    {
        slug: 'stranraer',
        name: 'Stranraer',
        townKeys: ['stranraer'],
        intro: [],
        metaDescription: '',
        gettingThere: [],
        faqs: [],
        nearby: ['newton-stewart'],
    },
];

export function areaBySlug(slug: string): Area | null {
    for (let i = 0; i < AREAS.length; i++) {
        if (AREAS[i].slug === slug) return AREAS[i];
    }
    return null;
}

/** The area a town belongs to, or null. Takes a townKey(), not a raw address. */
export function areaForTownKey(key: string): Area | null {
    if (!key) return null;
    for (let i = 0; i < AREAS.length; i++) {
        if (AREAS[i].townKeys.indexOf(key) !== -1) return AREAS[i];
    }
    return null;
}

/**
 * Whether this page may go in front of Google.
 *
 * TWO conditions, and both have to hold:
 *
 *   IT HAS BEEN WRITTEN. An area with no intro paragraphs is a heading and a
 *   grid of cards — the thin generated page these exist to beat. Publishing it
 *   would not just fail to rank, it would drag the rest of the site with it,
 *   because a cluster of near-identical pages is read as a quality signal
 *   about the whole domain.
 *
 *   IT HAS SOMETHING TO OFFER. A page promising cottages in a town with none
 *   is worse than no page: somebody arrives, finds an empty grid, and leaves.
 *
 * The second one is checked against the database at request time rather than
 * here, which is what lets a page appear in the sitemap the moment a property
 * is published there — no deploy. The first one is copy, and copy lives in
 * this file, so writing it is a deploy. That asymmetry is deliberate: adding
 * stock should be instant, publishing a new page should be a decision.
 */
export function hasCopy(area: Area): boolean {
    return area.intro.length > 0 && area.intro.some((p) => p.trim().length > 0);
}

export function isPublishable(area: Area, publishedListingCount: number): boolean {
    return hasCopy(area) && publishedListingCount > 0;
}
