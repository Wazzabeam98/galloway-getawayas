import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, FileText } from 'lucide-react';
import { AGREEMENTS, AGREEMENT_ORDER } from '@/lib/agreements';
import { ukDate } from '@/lib/dayKey';

export const metadata: Metadata = {
    title: 'Terms & Conditions',
    description: 'The terms on which you use Galloway Getaways as a guest, a host or a provider.',
    alternates: { canonical: '/terms' },
};

// The index of every agreement, as Airbnb lays its terms out: the Terms of
// Service everyone accepts, then the one extra agreement for each role. Each
// has its own page; the list comes from the registry (lib/agreements.ts).
export default function TermsPage() {
    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
            <h1 className="text-3xl font-bold text-slate-900 mb-3">Terms &amp; Conditions</h1>
            <p className="text-slate-600 mb-8 [text-wrap:pretty]">
                Everyone with an account agrees to our Terms of Service. Hosts, experience providers and
                tradespeople also agree to the one agreement for what they do, when they start doing it.
            </p>
            <ul className="divide-y divide-slate-200 border-y border-slate-200">
                {AGREEMENT_ORDER.map((key) => {
                    const a = AGREEMENTS[key];
                    return (
                        <li key={key}>
                            <Link href={a.path} className="group flex items-center gap-4 py-5">
                                <FileText className="h-5 w-5 shrink-0 text-slate-400" strokeWidth={1.75} />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-base font-semibold text-slate-900 group-hover:underline">{a.title}</span>
                                    <span className="block text-sm text-slate-500">{a.audience}</span>
                                    <span className="block text-[13px] text-slate-400">Last updated {ukDate(a.lastUpdated)}</span>
                                </span>
                                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                            </Link>
                        </li>
                    );
                })}
            </ul>
            <p className="mt-8 text-sm text-slate-500">
                See also our{' '}
                <Link href="/privacy" className="text-emerald-700 underline">Privacy Policy</Link> and{' '}
                <Link href="/cancellation-policy" className="text-emerald-700 underline">Cancellation &amp; Refund Policy</Link>.
            </p>
        </div>
    );
}
