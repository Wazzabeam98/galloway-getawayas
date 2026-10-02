'use client';

import { useEffect } from 'react';
import { rememberAccount } from '@/lib/signInMemory';
import { stayChoiceInBrowser } from '@/lib/staySignedIn';

// Rendered by the navbar while someone is signed in, so that the moment they
// sign out this browser already knows who they were — and the Log in or sign
// up panel greets them by name, with their photo and a masked address, as
// Airbnb does. Written on every signed-in page load, so a new photo or name is
// picked up without anyone having to sign in again. See lib/signInMemory.
export default function RememberAccount({
    firstName,
    avatarUrl,
    email,
    phone,
}: {
    firstName: string | null;
    avatarUrl: string | null;
    email: string | null | undefined;
    phone: string | null | undefined;
}) {
    useEffect(() => {
        // A shared computer ("don't stay signed in") is not told who you are.
        if (!firstName || !stayChoiceInBrowser()) return;
        if (email) {
            rememberAccount({ firstName, avatarUrl, kind: 'email', value: email.trim().toLowerCase() });
        } else if (phone) {
            rememberAccount({ firstName, avatarUrl, kind: 'phone', value: '+' + String(phone).replace(/^\+/, '') });
        }
    }, [firstName, avatarUrl, email, phone]);
    return null;
}
