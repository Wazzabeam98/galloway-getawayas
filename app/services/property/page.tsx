import { redirect } from 'next/navigation';

// The trade-tile grid ("For your property", with its coming-soon block) is gone.
// Everything it did now lives on /services itself — one list of tradespeople
// with filters.
//
// The real redirect is the permanent (308) one in next.config.js; this is only
// the fallback, and redirect() here would be a 307.
export default function PropertyServicesRedirect() {
    redirect('/services');
}
