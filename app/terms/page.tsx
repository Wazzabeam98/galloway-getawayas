import type { Metadata } from 'next';
import TermsBody from '@/components/legal/TermsBody';
import { TERMS_LAST_UPDATED } from '@/lib/hostTerms';

export const metadata: Metadata = {
    title: 'Terms & Conditions',
    description: 'The terms on which you use Galloway Getaways as a guest, a host or a provider.',
    alternates: { canonical: '/terms' },
};

export default function TermsPage() {
    return (
        <div className="max-w-3xl mx-auto px-6 py-12">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Terms &amp; Conditions</h1>
            <p className="text-sm text-slate-500 mb-10">Last updated {TERMS_LAST_UPDATED}</p>

            <TermsBody />
        </div>
    );
}
