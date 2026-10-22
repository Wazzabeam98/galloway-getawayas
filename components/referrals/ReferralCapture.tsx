'use client';

import { useEffect } from 'react';

// Fire-and-forget: tell the server which referral link was opened, so it can
// drop the cookie that survives sign-up. Renders nothing. A failure is silent —
// the worst case is a referral that is not attributed, never a broken page.
export default function ReferralCapture({ code }: { code: string }) {
    useEffect(() => {
        if (!code) return;
        fetch('/api/referrals/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        }).catch(() => {});
    }, [code]);
    return null;
}
