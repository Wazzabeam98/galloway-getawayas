'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { requireName } from '@/components/auth/FinishSignUpGate';

// Opens Finish signing up (first and last name) as the page loads — the prompt
// a holiday-let owner gets when they sign in (components/auth/FinishSignUpGate),
// in place of a banner asking them to go and find it. Strict, like the wizards'
// call: any nameless account is asked, however old. Then refreshes, so every
// name on the page updates.
//
// A tick's delay: this page's effects run before the root layout's, where the
// gate starts listening, so an ask sent at once would be lost.
export default function AskForName() {
    const router = useRouter();
    useEffect(() => {
        let live = true;
        const t = setTimeout(() => {
            requireName().then((ok) => { if (ok && live) router.refresh(); });
        }, 50);
        return () => { live = false; clearTimeout(t); };
    }, [router]);
    return null;
}
