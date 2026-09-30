import { redirect } from 'next/navigation';

// The trade-tile grid ("For your property", with its coming-soon block) is gone.
// Everything it did now lives on /services itself — one list of tradespeople
// with filters. This redirect keeps the old URL (and any bookmark or stray link)
// working.
export default function PropertyServicesRedirect() {
    redirect('/services');
}
