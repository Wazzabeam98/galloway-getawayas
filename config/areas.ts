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

    /**
     * A manual hold. When true the page stays noindex and out of the sitemap
     * EVEN IF the copy is written — a staging switch so a written page can be
     * checked (are the named attractions still open? is the copy right?) before
     * it is allowed in front of Google. Clearing it per town publishes that one.
     * It does NOT hide the page from a human who follows a link.
     */
    hold?: boolean;
}

// ORDER MATTERS: this is the order they appear in the footer and on the home
// page, so the towns with stock come first.
export const AREAS: Area[] = [
    {
        slug: "kirkcudbright",
        name: "Kirkcudbright",
        townKeys: ["kirkcudbright"],
        // Staged: copy written, held out of the index and sitemap until it has
        // been checked live. Clear `hold` to publish (still needs stock).
        hold: true,
        intro: [
            "Kirkcudbright — say it kur-KOO-bree — has been called the Artists’ Town since the late nineteenth century, when a colony of painters settled here for the quality of the light coming off the Dee estuary. They never really left. The town is still full of galleries, studios and independent shops, with Broughton House, Kirkcudbright Galleries and the Tolbooth Art Centre all within a few minutes’ walk of each other.",
            "It is a working harbour town rather than a museum piece. Boats still land scallops and shellfish, the streets are lined with pastel-painted houses, and MacLellan’s Castle sits in the middle of it all, roofless since the 1700s. There is a riverside walk along the Dee, a beach at Dhoon a few minutes out of town, and a summer programme of art trails, festivals and the floodlit tattoo.",
            "Most people heading for the Highlands drive straight past the turn-off. That is rather the point.",
        ],
        metaDescription: "Scotland’s Artists’ Town, on the River Dee. Pastel houses, a working harbour, and a light that has drawn painters here for two hundred years.",
        gettingThere: [],
        faqs: [],
        nearby: ["castle-douglas", "gatehouse-of-fleet", "dalbeattie"],
    },
    {
        slug: "castle-douglas",
        name: "Castle Douglas",
        townKeys: ["castledouglas"],
        // Staged: copy written, held out of the index and sitemap until it has
        // been checked live. Clear `hold` to publish (still needs stock).
        hold: true,
        intro: [
            "Castle Douglas is Scotland’s only designated Food Town, and it earns it — three long parallel streets of butchers, bakers, delis and independent shops, with a producers’ market once a month and food fairs through the year. If you are self-catering anywhere in this part of Galloway, this is where you come to fill the fridge properly.",
            "Threave Garden is a mile out of town: sixty-four acres run by the National Trust for Scotland, where their heritage gardeners are trained, with a walled garden, glasshouses and an osprey platform. Threave Castle is a little further on, a fourteenth-century tower house on an island in the Dee that you reach by ringing a bell for the ferryman.",
            "Carlingwark Loch sits at the edge of the town for boating, picnics and a playground, and the whole place is walkable end to end in twenty minutes.",
        ],
        metaDescription: "Scotland’s Food Town, with Threave Gardens on the doorstep and a loch at the end of the street.",
        gettingThere: [],
        faqs: [],
        nearby: ["kirkcudbright", "dalbeattie", "dumfries"],
    },
    {
        slug: "gatehouse-of-fleet",
        name: "Gatehouse of Fleet",
        townKeys: ["gatehouseoffleet"],
        // Staged: copy written, held out of the index and sitemap until it has
        // been checked live. Clear `hold` to publish (still needs stock).
        hold: true,
        intro: [
            "Gatehouse of Fleet takes its name from the toll house that stood on the old coach road between Dumfries and Stranraer. Robert Burns stayed at what is now the Murray Arms in 1793 and wrote the first draft of Scots Wha Hae there.",
            "The town was once a proper industrial place — mills, a brewery, its own port — and is now one of the quietest and prettiest villages in the south of Scotland. The clock tower at the end of the main street is the picture everyone takes. It sits on the Water of Fleet with wooded hills behind it, on the edge of a National Scenic Area and within reach of the Galloway Forest Park.",
            "Cardoness Castle stands on its rock a mile to the south-west, and Cream o’ Galloway is a short drive out at Rainton. The A75 bypassed the town in 1986, so getting here needs a deliberate turn off the main road — which is exactly why it has stayed the way it is.",
        ],
        metaDescription: "A quiet mill town on the Water of Fleet, bypassed by the main road in 1986 and all the better for it.",
        gettingThere: [],
        faqs: [],
        nearby: ["kirkcudbright", "newton-stewart"],
    },
    {
        slug: "dalbeattie",
        name: "Dalbeattie",
        townKeys: ["dalbeattie"],
        // Staged: copy written, held out of the index and sitemap until it has
        // been checked live. Clear `hold` to publish (still needs stock).
        hold: true,
        intro: [
            "Dalbeattie was built out of the grey granite quarried beside it — stone from here went into the Thames Embankment and lighthouses around the world — and the town still has the sparkle of it in the walls on a bright day.",
            "What most people come for is what surrounds it. Kippford and Rockcliffe sit on the Urr estuary a few minutes away, joined by the Jubilee Path along the shore. Sandyhills has one of the best beaches on the Solway. The Dalbeattie forest trails are among the better-known mountain biking routes in the south of Scotland, with something for children as well as the people in full body armour.",
            "It is an unpretentious town in a very good position.",
        ],
        metaDescription: "A granite town near the Solway coast, minutes from Kippford, Rockcliffe and the Sandyhills beaches.",
        gettingThere: [],
        faqs: [],
        nearby: ["castle-douglas", "kirkcudbright", "dumfries"],
    },
    {
        slug: "newton-stewart",
        name: "Newton Stewart",
        townKeys: ["newtonstewart"],
        // Staged: copy written, held out of the index and sitemap until it has
        // been checked live. Clear `hold` to publish (still needs stock).
        hold: true,
        intro: [
            "Newton Stewart sits on the River Cree where the coast road meets the hills, and it is the obvious base for anyone heading into the Galloway Forest Park. The park covers three hundred square miles of forest, loch and hill, and was the first place in Britain to be designated a Dark Sky Park — on a clear night you can see the Milky Way with the naked eye.",
            "Glen Trool, Loch Trool and the Merrick, the highest hill in southern Scotland, are all reached from here. The Cree is a well-known salmon and sea trout river. Wigtown, Scotland’s National Book Town, with its shops and its autumn book festival, is fifteen minutes south, and the Machars peninsula runs down from there to Whithorn and the sea.",
        ],
        metaDescription: "The gateway to the Galloway Forest Park, on the River Cree — walking, fishing and some of the darkest skies in Britain.",
        gettingThere: [],
        faqs: [],
        nearby: ["gatehouse-of-fleet", "wigtown"],
    },
    {
        slug: 'wigtown',
        name: 'Wigtown',
        townKeys: ['wigtown'],
        // Staged: copy written, held out of the index and sitemap until it has
        // been checked live. Clear `hold` to publish (still needs stock).
        hold: true,
        intro: [
            "Wigtown is Scotland’s National Book Town, which for a place of about a thousand people means an improbable number of bookshops — second-hand, antiquarian and new — strung around a broad central square. The designation came in 1998 and the town rebuilt itself around it; The Bookshop on North Main Street is the largest second-hand bookshop in Scotland.",
            "Every autumn the Wigtown Book Festival brings ten days of writers, talks and events and fills the town. The rest of the year it is quiet, which is the other half of the appeal — a wet afternoon works through the shelves, a dry one goes down to the salt marsh below the town where the Bladnoch meets Wigtown Bay.",
            "It sits at the top of the Machars, the peninsula running south to Whithorn — where St Ninian landed, the cradle of Scottish Christianity — and on to the Isle of Whithorn and the sea. Bladnoch, Scotland’s most southerly distillery, is a mile out of town, and Newton Stewart and the Galloway Forest Park are fifteen minutes north.",
        ],
        metaDescription: "Scotland’s National Book Town, on the Machars — more bookshops than a place its size has any right to, and a book festival every autumn.",
        gettingThere: [],
        faqs: [],
        nearby: ['newton-stewart', 'gatehouse-of-fleet'],
    },
    {
        slug: "dumfries",
        name: "Dumfries",
        townKeys: ["dumfries"],
        // Staged: copy written, held out of the index and sitemap until it has
        // been checked live. Clear `hold` to publish (still needs stock).
        hold: true,
        intro: [
            "Dumfries is the biggest town in the region and the one with the most going on — shops, restaurants, a theatre, and the practical things a longer stay needs. It sits on the River Nith, crossed by the fifteenth-century Devorgilla Bridge, one of the oldest standing bridges in Scotland.",
            "Robert Burns spent his final years here and is buried in St Michael’s churchyard. The Robert Burns Centre, his house on Burns Street and the Globe Inn are all within walking distance of each other, which makes for a good afternoon whether or not you arrived a Burns enthusiast.",
            "Caerlaverock Castle, a moated triangular fortress on the Solway, is a short drive south, next to a wetland reserve that fills with barnacle geese over winter. Mabie Forest and the Dalbeattie trails are close by for mountain biking.",
        ],
        metaDescription: "The region’s largest town, on the River Nith, and the place Robert Burns spent his last years.",
        gettingThere: [],
        faqs: [],
        nearby: ["castle-douglas", "dalbeattie", "moffat"],
    },
    {
        slug: "moffat",
        name: "Moffat",
        townKeys: ["moffat"],
        // Staged: copy written, held out of the index and sitemap until it has
        // been checked live. Clear `hold` to publish (still needs stock).
        hold: true,
        intro: [
            "Moffat is in the east of the region, in the hills near the head of Annandale, and it does not look like anywhere else nearby — a broad main street of substantial buildings from its days as a spa town, when people came to take the sulphurous waters.",
            "The landscape around it is the draw. The Devil’s Beef Tub is a vast natural hollow in the hills north of the town where the Border reivers once hid stolen cattle. The Grey Mare’s Tail is one of the highest waterfalls in Britain, a two-hundred-foot drop on the road towards St Mary’s Loch. Both are within a short drive.",
            "It is the closest of our towns to the M74, which makes it an easy first or last night if you are driving from the south.",
        ],
        metaDescription: "A handsome former spa town in the hills, at the foot of the Devil’s Beef Tub and the Grey Mare’s Tail.",
        gettingThere: [],
        faqs: [],
        nearby: ["dumfries"],
    },
    {
        slug: "stranraer",
        name: "Stranraer",
        townKeys: ["stranraer"],
        // Staged: copy written, held out of the index and sitemap until it has
        // been checked live. Clear `hold` to publish (still needs stock).
        hold: true,
        intro: [
            "Stranraer sits at the head of Loch Ryan, a deep sea loch on the west coast, and is the largest town in that half of the region. It was the ferry port for Northern Ireland for generations; since the ferries moved up the loch to Cairnryan the waterfront has been slowly turning back towards the town, with the oyster festival in September now one of the bigger events in the local calendar.",
            "It is the practical base for the Rhins of Galloway — the long peninsula running south to the Mull, with Portpatrick on its western shore and the Logan Botanic Garden partway down, where the Gulf Stream lets palms and tree ferns grow outdoors. Castle Kennedy Gardens, between two lochs on the road east, are worth an afternoon.",
        ],
        metaDescription: "On the shore of Loch Ryan at the head of the Rhins, with the whole west coast from there.",
        gettingThere: [],
        faqs: [],
        nearby: ["newton-stewart", "portpatrick"],
    },
    {
        slug: "portpatrick",
        name: "Portpatrick",
        townKeys: ["portpatrick"],
        // Staged: copy written, held out of the index and sitemap until it has
        // been checked live. Clear `hold` to publish (still needs stock).
        hold: true,
        intro: [
            "Portpatrick sits in a small rocky bay on the far west of the Rhins of Galloway, its harbour ringed by pastel houses and cliffs. It grew up on fishing and later on the crossing to Northern Ireland — Irish couples once came here to marry, the way others went to Gretna.",
            "These days it is a place for walking, eating and looking at the sea. The Southern Upland Way starts here and climbs straight onto the clifftops, which means you can do a serious coastal walk in the morning and be in a harbour pub by lunchtime. The Mull of Galloway, Scotland’s most southerly point, with its lighthouse and seabird cliffs, is about forty minutes down the peninsula.",
            "It is the furthest west of our towns and worth the drive.",
        ],
        metaDescription: "A pastel-coloured harbour village on the Rhins, and the western end of the Southern Upland Way.",
        gettingThere: [],
        faqs: [],
        nearby: ["stranraer"],
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
    return hasCopy(area) && !area.hold && publishedListingCount > 0;
}
