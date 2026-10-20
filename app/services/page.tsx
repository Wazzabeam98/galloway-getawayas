import TradeDirectory from '@/components/services/TradeDirectory';
import { adminClient } from '@/lib/supabaseAdmin';
import { loadPublicTrades } from '@/lib/publicTrades';

// Indexable only while somebody is in the directory. The list itself loads in
// the browser, so with no approved tradespeople a crawler sees a heading, two
// filters and "Loading…" — a thin page, and one the sitemap would otherwise
// offer. It comes back into the index on its own (and into the sitemap) the
// first time a trade is approved. A failed read errs towards indexing: one bad
// query should not drop a real page out of search.
export async function generateMetadata(): Promise<import('next').Metadata> {
    let empty = false;
    try {
        empty = (await loadPublicTrades(adminClient())).length === 0;
    } catch {
        empty = false;
    }
    return {
        title: 'Tradespeople for your property',
        description:
            'Local tradespeople for holiday lets across Dumfries & Galloway — joiners, plumbers, '
            + 'electricians, roofers and more. See who covers you and ask one.',
        alternates: { canonical: '/services' },
        ...(empty ? { robots: { index: false, follow: true } } : {}),
    };
}

// /services IS the tradespeople list now.
//
// It used to be a signpost that asked the visitor to say who they were, sending
// owners on to a trade-tile grid at /services/property and then to a per-trade
// shop. That whole funnel is gone: a host lands straight on one list of
// tradesperson cards, laid out like the property search (a grid of cards, no
// map, full width), with area and trade filters along the top. See
// components/services/TradeDirectory for the list and its data.
//
// The old routes still resolve: /services/property and /services/<trade> now
// redirect here (the trade one carrying its trade through as a filter).
export default function ServicesPage() {
    return <TradeDirectory />;
}
