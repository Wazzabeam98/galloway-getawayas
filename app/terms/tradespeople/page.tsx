import type { Metadata } from 'next';
import AgreementPage from '@/components/legal/AgreementPage';
import { AGREEMENTS } from '@/lib/agreements';

const doc = AGREEMENTS['tradesperson'];

export const metadata: Metadata = {
    title: doc.title,
    description: doc.audience,
    alternates: { canonical: doc.path },
};

export default function Page() {
    return <AgreementPage doc="tradesperson" />;
}
