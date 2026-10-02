'use client';

import { useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { makeAuthCookiesSessionOnly, stayChoiceInBrowser } from '@/lib/staySignedIn';

// In a tab left open, the access token refreshes every hour and the page script
// rewrites the sign-in cookie — which Safari caps at seven days. Straight after
// each refresh this asks the server to re-issue it with the chosen lifetime
// (the middleware does that on /api/auth/keep), or, for someone who chose not
// to stay signed in, turns it back into a cookie that ends with the browser.
// See lib/staySignedIn.
export default function KeepSignedIn() {
    useEffect(() => {
        const supabase = createClientComponentClient();
        const { data } = supabase.auth.onAuthStateChange((event) => {
            if (event !== 'TOKEN_REFRESHED' && event !== 'SIGNED_IN') return;
            if (stayChoiceInBrowser()) {
                fetch('/api/auth/keep', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
            } else {
                makeAuthCookiesSessionOnly();
            }
        });
        return () => data.subscription.unsubscribe();
    }, []);
    return null;
}
