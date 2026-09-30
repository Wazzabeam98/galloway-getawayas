import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { AGREEMENTS, AgreementKey } from '@/lib/agreements';
import { ukDate } from '@/lib/dayKey';
import AgreementBody from '@/components/legal/AgreementBody';

// One agreement on its own page: /terms/guests, /terms/hosts,
// /terms/experience-providers, /terms/tradespeople.
export default function AgreementPage({ doc }: { doc: AgreementKey }) {
    const a = AGREEMENTS[doc];
    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
            <Link href="/terms" className="mb-6 inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
                <ChevronLeft className="h-4 w-4" /> All terms
            </Link>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">{a.title}</h1>
            <p className="text-sm text-slate-500 mb-1">{a.audience}</p>
            <p className="text-sm text-slate-500 mb-10">Last updated {ukDate(a.lastUpdated)} · Version {a.version}</p>
            <AgreementBody doc={doc} />
        </div>
    );
}
