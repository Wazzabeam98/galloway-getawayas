import LegalMarkdown from '@/components/legal/LegalMarkdown';
import { EXPERIENCE_PROVIDER_AGREEMENT } from '@/components/legal/agreements/text/experience-provider';

// THE EXPERIENCE PROVIDER AGREEMENT — accepted on top of the Guest Terms at the
// end of the guest-experience sign-up (lib/agreements.ts, key
// 'experience_provider'). The wording is in ./text/experience-provider.ts.
export default function ExperienceProviderAgreement() {
    return <LegalMarkdown source={EXPERIENCE_PROVIDER_AGREEMENT} />;
}
