'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// The sign-up used to live here, as one long page, with the trade picker on a
// route of its own at /services/join. It is now a stepped modal and the trade
// is step one of it, so both live at /services/join.
//
// This route stays because it is in the wild: the auth callback redirects to
// it after somebody confirms their email halfway through an application, and
// anybody who bookmarked it or was sent it in a message would otherwise land
// on a 404 having already filled the form in. The draft is keyed on the trade
// in local storage, so carrying ?trade= across is what makes their work
// reappear rather than a blank first step.
function ApplyRedirect() {
    const router = useRouter();
    const params = useSearchParams();

    useEffect(() => {
        const trade = String(params.get('trade') || '');
        router.replace('/services/join' + (trade ? '?trade=' + encodeURIComponent(trade) : ''));
    }, [router, params]);

    return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-slate-500">Taking you to your application…</div>;
}

export default function JoinApplyPage() {
    return (
        <Suspense fallback={<div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-slate-500">Loading…</div>}>
            <ApplyRedirect />
        </Suspense>
    );
}
