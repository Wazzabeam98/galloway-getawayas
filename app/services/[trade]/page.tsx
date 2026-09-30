import { redirect } from 'next/navigation';
import { tradeListHref } from '@/lib/serviceProviders';

// There is no separate page per trade any more. Trade type is a filter on the
// one list at /services, so the old per-trade URL carries its trade through as
// that filter — /services/joiner → /services?trade=joiner.
//
// The real redirect is the permanent (308) one in next.config.js, which answers
// before this page is ever reached. This is only the fallback should that list
// miss a key; redirect() here is a 307 on Next 13.5, so it is not the one to
// rely on.
//
// The public profile of one tradesperson still lives below this, at
// /services/<trade>/<providerId>; only the per-trade LIST is gone.
//
// (The [trade] layout has already 404'd anything that is not a known trade key.)
export default function TradeRedirect({ params }: { params: { trade: string } }) {
    redirect(tradeListHref(String(params.trade || '')));
}
