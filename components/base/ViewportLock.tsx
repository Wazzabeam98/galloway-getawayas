'use client';

import { useEffect } from 'react';
import { isIOS } from '@/lib/viewport';

// iOS Safari zooms the whole page the instant a text field is tapped and keeps
// that zoom for the rest of the visit (seen through 16px and 17px fields on an
// iPhone 15, 03/10/2026). maximum-scale=1 + user-scalable=no stops it; Safari
// has ignored both for PINCHING since iOS 10, so iPhone users can still pinch.
// Android obeys them and would lose pinch, and never had the focus-zoom, so it
// keeps the plain viewport.
//
// This used to be chosen per request from the User-Agent in the root layout's
// generateMetadata — which read headers() and so forced every page to render
// per-request (uncacheable). The layout is now static and edge-cacheable; the
// plain viewport ships in the HTML for everyone, and this upgrades iOS to the
// no-zoom viewport on mount. The focus-zoom only fires when a field is tapped,
// which is always after mount, so the behaviour is unchanged.

export default function ViewportLock() {
    useEffect(() => {
        if (!isIOS(navigator.userAgent)) return;
        const meta = document.querySelector('meta[name="viewport"]');
        if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
    }, []);
    return null;
}
