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
     * What there is to do in and around the town. One string per paragraph.
     *
     * Named attractions and businesses are the value of this and also its
     * risk: a page recommending somewhere that has closed reads worse than a
     * page recommending nothing. Everything named here needs checking against
     * the real world before the area comes off `hold`.
     */
    thingsToDo: string[];

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
        thingsToDo: [
            "The town is the attraction. Broughton House on the High Street was the home of the artist E A Hornel and has a Japanese-inspired garden running down to the Dee — worth an hour on its own. Kirkcudbright Galleries, in the converted town hall, holds the town’s art collection and changes its exhibitions through the year, and the Tolbooth Art Centre sits in a seventeenth-century building that was once the jail. MacLellan’s Castle is roofless and free to wander when it’s open.",
            "Beyond the galleries, walk the riverside path along the Dee, or drive ten minutes to Dhoon Bay for the beach. The harbour still lands shellfish, and the town’s summer programme runs from the art and crafts trail in the spring through to the floodlit tattoo.",
            "Cream o’ Galloway is twenty minutes west if you have children with you, and Threave and Castle Douglas are fifteen minutes the other way.",
        ],
        gettingThere: [
            "Kirkcudbright is about 28 miles west of Dumfries, a few minutes south off the A75. From the border at Gretna it is roughly an hour and a quarter, straight along the A75 the whole way. Carlisle adds about fifteen minutes to that, Glasgow is around two hours, and Edinburgh a little over two.",
            "There is no railway station in the town. The nearest is Dumfries, about 45 minutes away by road, with connections to Carlisle and Glasgow. Buses run from Dumfries and Castle Douglas.",
            "Most people arrive by car, and you will want one — the beaches, the forest and the neighbouring towns are all short drives rather than walks.",
        ],
        faqs: [
            { question: "Is Kirkcudbright a good base for exploring Dumfries & Galloway?", answer: "It is one of the best. Castle Douglas is fifteen minutes, Gatehouse of Fleet twenty, Dalbeattie half an hour, and the Galloway Forest Park about forty-five minutes. Everything in the east of the region is within an hour." },
            { question: "Are there dog friendly cottages in Kirkcudbright?", answer: "Yes — look for the paw symbol on a listing. The beaches and the forest walks nearby make it a good spot for a dog." },
            { question: "How do you pronounce Kirkcudbright?", answer: "Kur-KOO-bree. The middle is swallowed. Nobody local will mind if you get it wrong, but you will hear it said properly within about a minute of arriving." },
            { question: "Is there a beach?", answer: "Dhoon Bay is a few minutes out of town. Brighouse Bay and Sandgreen are within twenty minutes, and Rockcliffe and Sandyhills are about forty." },
            { question: "What is there to do if it rains?", answer: "Kirkcudbright Galleries, Broughton House and the Tolbooth Art Centre are all in the town, with cafés and independent shops between them. It is a better wet-day town than most of the region." },
        ],
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
        thingsToDo: [
            "Eat, mostly, and then walk it off. The town’s three main streets are lined with butchers, bakers, delis and independent food shops, and the producers’ market runs on the third Sunday of the month.",
            "Threave Garden, a mile out, is sixty-four acres run by the National Trust for Scotland and the place their heritage gardeners are trained — a walled garden, glasshouses, rockeries, and an osprey platform and bat reserve on the estate. Threave Castle is a little further, a fourteenth-century tower on an island in the Dee that you reach by ringing a bell for the ferryman, which is the best approach to any castle in the region.",
            "Carlingwark Loch is at the edge of the town for boating and picnics, with a playground for children. Loch Ken, ten minutes north, has watersports and some of the best coarse fishing in Scotland.",
        ],
        gettingThere: [
            "Castle Douglas sits directly on the A75, 18 miles west of Dumfries. From Gretna it is about an hour, and from Carlisle around an hour and a quarter. Glasgow is roughly an hour and three quarters, Edinburgh a little over two.",
            "The nearest railway station is Dumfries, about half an hour away, with connections to Carlisle and Glasgow. Buses run along the A75 corridor between Dumfries and Stranraer and stop here.",
            "Being on the main road makes this one of the easiest towns in the region to reach, and the town itself is walkable end to end.",
        ],
        faqs: [
            { question: "Why is it called Scotland’s Food Town?", answer: "It is the only town in Scotland with the designation. Three streets of butchers, bakers, delis and independent food shops, a monthly producers’ market, and food fairs through the year." },
            { question: "Is Castle Douglas good for families?", answer: "Yes. Carlingwark Loch has a playground and boating, Threave has gardens and a castle you reach by ferry, and there are farm attractions a short drive out." },
            { question: "Are there dog friendly cottages in Castle Douglas?", answer: "Yes — look for the paw symbol on a listing. Threave and the loch paths are both good dog walks." },
            { question: "How far is Threave Garden?", answer: "About a mile from the town centre, walkable in half an hour or a five-minute drive. Threave Castle is a little further west, reached by a short ferry." },
            { question: "Is there a supermarket?", answer: "Yes, along with the independents. It is the practical shopping town for this part of the region." },
        ],
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
        thingsToDo: [
            "Gatehouse is a town for a slow day. The Mill on the Fleet, in a restored eighteenth-century cotton mill by the river, has exhibitions, a bookshop and a café looking over the water. The clock tower at the end of the main street is the photograph everybody takes.",
            "Cardoness Castle stands on its rock a mile south-west, a fifteenth-century tower house with views down the estuary. Cally Woods, on the edge of the town, has waymarked walks through what was once a country estate.",
            "The Fleet Bay beaches at Sandgreen and Mossyard are ten minutes away and rarely busy. Cream o’ Galloway at Rainton is a short drive for ice cream and a farm visit, and the southern edge of the Galloway Forest Park is within half an hour.",
        ],
        gettingThere: [
            "Gatehouse of Fleet is about 32 miles west of Dumfries, a mile north of the A75. From Gretna it is roughly an hour and a quarter to an hour and a half; Carlisle is a little more. Glasgow is around two hours.",
            "The A75 bypassed the town in 1986, so you need to take a deliberate turn off the main road — it is signposted and takes a minute, and it is the reason the town is as quiet as it is.",
            "The nearest railway station is Dumfries, about fifty minutes away. Buses on the Dumfries–Stranraer route stop here.",
        ],
        faqs: [
            { question: "Is Gatehouse of Fleet worth staying in rather than passing through?", answer: "It is one of the quietest and prettiest towns in the south of Scotland, on the Water of Fleet with wooded hills behind it. If you want somewhere still, this is it." },
            { question: "What is there to do?", answer: "Cardoness Castle is a mile away, Cream o’ Galloway is a short drive at Rainton, and the Fleet Bay beaches are ten minutes. The Galloway Forest Park is within half an hour." },
            { question: "Are there dog friendly cottages in Gatehouse of Fleet?", answer: "Yes — look for the paw symbol on a listing. The riverside and forest walks start from the town." },
            { question: "Is it near the coast?", answer: "Yes. Sandgreen and Mossyard are about ten minutes, on Fleet Bay." },
            { question: "How far is Kirkcudbright?", answer: "About twenty minutes east." },
        ],
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
        thingsToDo: [
            "The forest and the coast, in roughly equal measure. Dalbeattie Forest is one of the 7stanes mountain biking centres, with routes from gentle green trails up to the technical rock slabs the place is known for — and good walking on the same paths if you’re not on a bike.",
            "Five minutes south, Kippford and Rockcliffe sit on the Urr estuary, joined by the Jubilee Path along the shore — an easy walk with the Mote of Mark, an ancient hillfort, above it. Sandyhills has the best sandy beach on this stretch of the Solway, about fifteen minutes on.",
            "The Dalbeattie Museum covers the town’s granite and shipping history, which sounds dry and isn’t — the stone from here went into the Thames Embankment and lighthouses around the world.",
        ],
        gettingThere: [
            "Dalbeattie is 14 miles south-west of Dumfries, on the A711. From Gretna it is about fifty minutes, from Carlisle a little over an hour. Glasgow is around an hour and three quarters.",
            "The nearest railway station is Dumfries, about twenty-five minutes away, with connections to Carlisle and Glasgow.",
            "It is the closest of our towns to the Solway coast villages, which is what most people are here for.",
        ],
        faqs: [
            { question: "What is there to do near Dalbeattie?", answer: "Kippford and Rockcliffe are five minutes away on the Urr estuary, linked by the Jubilee Path along the shore. Sandyhills beach is about fifteen minutes. The Dalbeattie forest mountain bike trails start on the edge of town." },
            { question: "Is it good for mountain biking?", answer: "Yes — Dalbeattie is one of the 7stanes trail centres, with routes from family green up to the well-known technical sections." },
            { question: "Are there dog friendly cottages in Dalbeattie?", answer: "Yes — look for the paw symbol on a listing. The forest and the coast paths are both on the doorstep." },
            { question: "Is there a beach?", answer: "Sandyhills is the nearest proper sandy beach, about fifteen minutes. Rockcliffe has a smaller shore and better views." },
            { question: "How far is Kirkcudbright or Castle Douglas?", answer: "Both about twenty to twenty-five minutes." },
        ],
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
        thingsToDo: [
            "This is the base for the Galloway Forest Park — three hundred square miles of forest, loch and hill, and the first Dark Sky Park in Britain. Glen Trool and Loch Trool are half an hour up the road, with Bruce’s Stone above the loch marking a battle in 1307 and a view that justifies the walk on its own. The Merrick, the highest hill in southern Scotland, is climbed from the same car park.",
            "On a clear night from anywhere in the park you can see the Milky Way without equipment. Best from autumn to early spring when the nights are long.",
            "Kirroughtree is another of the 7stanes mountain biking centres, a few minutes east. The River Cree runs through the town for salmon and sea trout, and Wigtown and the Machars are fifteen minutes south.",
        ],
        gettingThere: [
            "Newton Stewart is 50 miles west of Dumfries on the A75. From Gretna it is about an hour and a half, from Carlisle a little under two hours. Glasgow is around two hours, mostly on the A77 and A714.",
            "There is no railway station. The nearest are Stranraer, about forty minutes west, and Barrhill on the Glasgow–Stranraer line. Buses run along the A75.",
            "A car is essential here — the forest park, the lochs and the Machars are all drives rather than walks.",
        ],
        faqs: [
            { question: "Is Newton Stewart the best base for the Galloway Forest Park?", answer: "Yes. Glen Trool and Loch Trool are within half an hour, and the Merrick — the highest hill in southern Scotland — is climbed from there." },
            { question: "Can you really see the stars?", answer: "The Galloway Forest Park was the first Dark Sky Park in Britain. On a clear moonless night the Milky Way is visible without any equipment. Best from autumn through to early spring, when the nights are long enough." },
            { question: "Are there dog friendly cottages in Newton Stewart?", answer: "Yes — look for the paw symbol on a listing. The forest trails are as good a dog walk as anywhere in Scotland." },
            { question: "How far is Wigtown, the book town?", answer: "About fifteen minutes south. The book festival runs each autumn." },
            { question: "Is there good fishing?", answer: "The Cree is a well-known salmon and sea trout river, and there are lochs nearby. Permits are arranged locally." },
        ],
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
        thingsToDo: [
            "Wigtown is Scotland’s National Book Town, and that is genuinely what you come for — a small town with more bookshops than seems reasonable, including The Bookshop, one of the largest second-hand bookshops in the country. An afternoon disappears easily.",
            "The Wigtown Book Festival runs each autumn and brings authors and readers from all over; the town books up well in advance for it.",
            "Wigtown Bay is the largest local nature reserve in Britain, with a bird hide above the merse. South of here the Machars peninsula runs down to Whithorn, where Christianity is said to have first arrived in Scotland, and on to the Isle of Whithorn and its ruined chapel by the sea. Bladnoch Distillery is on the edge of the town.",
        ],
        gettingThere: [
            "Wigtown is about fifteen minutes south of Newton Stewart, on the A714 towards the Machars. From Dumfries it is around an hour and ten minutes, and from Gretna about an hour and three quarters.",
            "The nearest railway stations are Stranraer and Barrhill, both around forty minutes. A car is essential.",
        ],
        faqs: [
            { question: "What is Wigtown known for?", answer: "It is Scotland’s National Book Town — a small town with a disproportionate number of bookshops, including one of the largest second-hand bookshops in the country." },
            { question: "When is the book festival?", answer: "Each autumn, usually late September into October. It brings authors and readers from all over and the town books up well in advance." },
            { question: "Are there dog friendly cottages in Wigtown?", answer: "Yes — look for the paw symbol on a listing." },
            { question: "What else is nearby?", answer: "Wigtown Bay is the largest local nature reserve in Britain, good for birds. The Machars peninsula runs south from here to Whithorn, where Christianity is said to have first arrived in Scotland." },
        ],
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
        thingsToDo: [
            "Burns, mostly, and then the coast. Robert Burns spent his last years in Dumfries and the town makes the most of it: the Robert Burns Centre in a converted watermill on the Nith, Burns House on Burns Street where he died, his mausoleum in St Michael’s churchyard, and the Globe Inn, which was his local and is still a pub.",
            "Dumfries Museum sits in an eighteenth-century windmill with a camera obscura at the top, which on a clear day projects the whole town onto a table.",
            "Caerlaverock Castle is fifteen minutes south — a moated triangular fortress, unusual and photogenic — and next to it the WWT reserve, which fills with barnacle geese and whooper swans from October. Mabie Forest has more 7stanes mountain biking, and Southerness has a long sandy beach and a lighthouse about forty minutes down the coast.",
        ],
        gettingThere: [
            "Dumfries is the largest town in the region, 25 miles from the border at Gretna — about half an hour on the A75. Carlisle is roughly forty-five minutes, Glasgow an hour and a half, Edinburgh an hour and three quarters.",
            "Dumfries has a railway station on the Glasgow to Carlisle line, which makes it the only town in this list you can comfortably reach without a car. Buses run from here across the whole region.",
            "If you are coming from England and want to arrive quickly, this is the easiest town in the region to get to.",
        ],
        faqs: [
            { question: "Can I get to Dumfries by train?", answer: "Yes. It is on the Glasgow to Carlisle line, with connections south to the West Coast Main Line. It is the most practical base in the region without a car." },
            { question: "What is there to do in Dumfries?", answer: "The Robert Burns Centre, Burns House and his grave at St Michael’s are all walkable. Caerlaverock Castle and the wetland reserve are a short drive south, and Mabie Forest has mountain bike trails." },
            { question: "Are there dog friendly cottages in Dumfries?", answer: "Yes — look for the paw symbol on a listing." },
            { question: "Is Dumfries a good base for the rest of the region?", answer: "For the east, yes. Castle Douglas is half an hour, Kirkcudbright forty-five minutes, Moffat forty. Stranraer and the far west are over an hour and a half, so pick something further west if that is where you are heading." },
            { question: "Is there a beach nearby?", answer: "The Solway coast at Southerness is about forty minutes, with a long sandy beach and a lighthouse." },
        ],
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
        thingsToDo: [
            "Moffat is a walking town. The Devil’s Beef Tub, a vast natural hollow in the hills a few miles north, is where the Border reivers hid stolen cattle — there is a viewpoint from the road and a walk from there if you want it.",
            "The Grey Mare’s Tail, twenty minutes east on the road to St Mary’s Loch, is one of the highest waterfalls in Britain, with a steep path climbing beside it to a hanging valley and a loch at the top.",
            "In the town itself, the broad main street is lined with shops and cafés from its spa days, and the Moffat Museum covers the town’s history. Moffat Woollen Mill is the obvious stop for a gift on the way home. The town also has a dark sky observatory nearby and sits on the Southern Upland Way, which passes a few miles to the west.",
        ],
        gettingThere: [
            "Moffat is in the east of the region, 21 miles north of Dumfries and about two miles off the M74 — the easiest town on this list to reach from the motorway.",
            "From Gretna it is roughly half an hour straight up the M74. Carlisle is about forty-five minutes, Glasgow an hour, Edinburgh an hour.",
            "The nearest railway stations are Lockerbie, about fifteen minutes away on the West Coast Main Line, and Dumfries. Lockerbie has direct trains to London and Glasgow, which makes Moffat surprisingly reachable by rail.",
        ],
        faqs: [
            { question: "Why is Moffat different from the rest of the region?", answer: "It is inland and in the hills rather than on the coast, and it was a spa town — which is why the main street is so much grander than the size of the place suggests." },
            { question: "What is the Devil’s Beef Tub?", answer: "A vast natural hollow in the hills a few miles north of the town, where Border reivers once hid stolen cattle. There is a viewpoint from the road." },
            { question: "How far is the Grey Mare’s Tail?", answer: "About twenty minutes east, on the road towards St Mary’s Loch. It is one of the highest waterfalls in Britain, with a steep path up beside it." },
            { question: "Are there dog friendly cottages in Moffat?", answer: "Yes — look for the paw symbol on a listing. The hill walking straight from the town is the draw." },
            { question: "Is Moffat a good stop on the way north?", answer: "It is two miles off the M74, so yes — a lot of people use it as a first or last night rather than driving the whole way in one go." },
        ],
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
        thingsToDo: [
            "Stranraer is the base for the Rhins, and the peninsula is where you’ll spend most of your time. Castle Kennedy Gardens, on the road east, run between two lochs across seventy-five acres, with a ruined castle and a monkey puzzle avenue. Logan Botanic Garden, half an hour south, is warmed enough by the Gulf Stream to grow palms and tree ferns outdoors, which is startling at this latitude.",
            "The Mull of Galloway at the very bottom is Scotland’s most southerly point — lighthouse, seabird cliffs, and on a clear day a view of Ireland, the Isle of Man and the Lake District at once.",
            "In the town, the Castle of St John sits in the middle of the main street, and the oyster festival takes over the waterfront each September. Loch Ryan has the last wild native oyster fishery in Scotland.",
        ],
        gettingThere: [
            "Stranraer is at the far west of the region, 74 miles from Dumfries at the end of the A75. From Gretna it is around two hours; from Carlisle a little more. Glasgow is about two and a quarter hours down the A77.",
            "Stranraer has a railway station at the end of the line from Glasgow via Ayr and Girvan. The Northern Ireland ferries leave from Cairnryan, about ten minutes north up Loch Ryan.",
            "It is a long drive from the border, so plan on it being most of a day if you are coming from the south of England.",
        ],
        faqs: [
            { question: "Is Stranraer a good base for the Rhins of Galloway?", answer: "Yes — it is the practical town at the head of the peninsula. Portpatrick is fifteen minutes west, the Logan Botanic Garden about half an hour south, and the Mull of Galloway forty-five minutes." },
            { question: "How far is the ferry to Northern Ireland?", answer: "The ferries go from Cairnryan, about ten minutes north of the town." },
            { question: "What is the oyster festival?", answer: "Stranraer holds an oyster festival each September, on the loch shore. Loch Ryan has the last wild native oyster fishery in Scotland." },
            { question: "Are there dog friendly cottages in Stranraer?", answer: "Yes — look for the paw symbol on a listing." },
            { question: "Can I get here by train?", answer: "Yes, from Glasgow via Ayr and Girvan. It is the only station in the west of the region." },
        ],
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
        thingsToDo: [
            "Walking and the sea. The Southern Upland Way starts on the harbour and climbs straight onto the cliffs, and the first few miles north towards Killantringan lighthouse make an excellent morning with a pub lunch at the end of it.",
            "The harbour itself is the other half of the appeal — pastel houses round a small rocky bay, with pubs and restaurants along the front and boats coming and going. There is a small beach, and rock pools at low tide.",
            "Dunskey Castle stands ruined on the cliff a short walk south, and Dunskey Estate above the village has walled gardens and woodland paths. The Mull of Galloway and Logan Botanic Garden are both within forty minutes down the peninsula.",
        ],
        gettingThere: [
            "Portpatrick is on the west coast of the Rhins of Galloway, about fifteen minutes beyond Stranraer at the very end of the A77.",
            "From Gretna it is roughly two hours and a quarter, and from Carlisle a little more. Glasgow is around two and a half hours. It is the furthest of our towns from the border, and worth knowing that before you set off.",
            "The nearest railway station is Stranraer, fifteen minutes away. There is no practical way to get here without a car unless you are walking the Southern Upland Way, which starts on the harbour.",
        ],
        faqs: [
            { question: "Is Portpatrick worth the drive?", answer: "It is the prettiest harbour village in the region and the furthest west. If you want a proper coastal base rather than a touring one, yes." },
            { question: "What is the Southern Upland Way?", answer: "Scotland’s coast-to-coast long distance path, 214 miles from Portpatrick to Cockburnspath on the east coast. It starts at the harbour and climbs onto the cliffs immediately, so you can do the first stretch as a morning walk." },
            { question: "How far is the Mull of Galloway?", answer: "About forty minutes south — Scotland’s most southerly point, with a lighthouse and seabird cliffs." },
            { question: "Are there dog friendly cottages in Portpatrick?", answer: "Yes — look for the paw symbol on a listing. The clifftop walks are the reason people bring dogs here." },
            { question: "Is there much to do in the evening?", answer: "There are pubs and restaurants around the harbour, and that is most of it. It is a quiet place by design." },
        ],
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
