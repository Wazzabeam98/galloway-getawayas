import type { AgreementKey } from '@/lib/agreements';
import GuestTerms from '@/components/legal/agreements/GuestTerms';
import HostAgreement from '@/components/legal/agreements/HostAgreement';
import ExperienceProviderAgreement from '@/components/legal/agreements/ExperienceProviderAgreement';
import TradespersonAgreement from '@/components/legal/agreements/TradespersonAgreement';

// The full text of one agreement, by key — for its page, the tick box's modal
// and the sign-in prompt. Each document's wording lives in the one file named by
// `textFile` in lib/agreements.ts; this only picks which.
export default function AgreementBody({ doc }: { doc: AgreementKey }) {
    if (doc === 'host') return <HostAgreement />;
    if (doc === 'experience_provider') return <ExperienceProviderAgreement />;
    if (doc === 'tradesperson') return <TradespersonAgreement />;
    return <GuestTerms />;
}
