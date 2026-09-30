import TradeDirectory from '@/components/services/TradeDirectory';

export const metadata = {
    title: 'Tradespeople for your property',
    description:
        'Local tradespeople covering holiday lets across Dumfries & Galloway — joiners, plumbers, '
        + 'electricians, roofers and more. See who covers you and ask one of them.',
    alternates: { canonical: '/services' },
};

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
