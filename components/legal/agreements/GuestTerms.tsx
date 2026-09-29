import LegalMarkdown from '@/components/legal/LegalMarkdown';
import { GUEST_TERMS } from '@/components/legal/agreements/text/guest';

// THE GUEST TERMS — the general terms every account accepts when it is made
// (lib/agreements.ts, key 'guest'). The wording is in ./text/guest.ts.
export default function GuestTerms() {
    return <LegalMarkdown source={GUEST_TERMS} />;
}
