import LegalMarkdown from '@/components/legal/LegalMarkdown';
import { TRADESPERSON_AGREEMENT } from '@/components/legal/agreements/text/tradesperson';

// THE TRADESPERSON AGREEMENT — accepted on top of the Guest Terms at the end of
// the trade sign-up (lib/agreements.ts, key 'tradesperson'). The wording is in
// ./text/tradesperson.ts.
export default function TradespersonAgreement() {
    return <LegalMarkdown source={TRADESPERSON_AGREEMENT} />;
}
