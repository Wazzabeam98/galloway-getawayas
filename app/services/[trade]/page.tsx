import { redirect } from 'next/navigation';
import { audienceForTrade, isTradeComingSoon } from '@/lib/serviceProviders';

// There is no separate page per trade any more. Trade type is a filter on the
// one list at /services, so the old per-trade URL carries its trade through as
// that filter — /services/joiner → /services?trade=joiner.
//
// The public profile of one tradesperson still lives below this, at
// /services/<trade>/<providerId>; only the per-trade LIST is gone.
//
// (The [trade] layout has already 404'd anything that is not a known trade key.)
export default function TradeRedirect({ params }: { params: { trade: string } }) {
    const trade = String(params.trade || '');

    // A guest experience is not a host trade and never belonged in this shop —
    // send them to the cottages, where an experience is booked against a stay.
    if (audienceForTrade(trade) === 'guest') redirect('/');

    // An open host trade filters the list; a coming-soon one has nothing to show,
    // so it lands on the unfiltered list.
    if (isTradeComingSoon(trade)) redirect('/services');
    redirect('/services?trade=' + encodeURIComponent(trade));
}
