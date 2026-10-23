import type { Metadata } from 'next';
import { SUPPORTERS } from '@/config/supporters';

export const metadata: Metadata = {
    title: 'Our local commitment',
    description:
        'Galloway Getaways is locally owned in Dumfries & Galloway, helps guests book direct '
        + 'with local hosts and providers with no guest booking fee, and is a Proud Supporter of '
        + 'the Galloway and Southern Ayrshire UNESCO Biosphere.',
    alternates: { canonical: '/local-commitment' },
};

// The Biosphere badge is kept in config/supporters.ts so the footer strip and
// this page always show the same artwork and link.
const biosphere = SUPPORTERS.find((s) => s.name === 'GSA UNESCO Biosphere');

export default function LocalCommitmentPage() {
    return (
        <div className="max-w-3xl mx-auto px-6 py-12">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Our local commitment</h1>
            <p className="text-sm text-slate-500 mb-10">Dumfries &amp; Galloway, Scotland</p>

            <div className="prose prose-slate max-w-none">
                <p className="text-slate-700 mb-4">
                    Galloway Getaways is locally owned, here in Dumfries &amp; Galloway. We&apos;re not a
                    national booking site with an office somewhere else &mdash; the people running it live
                    in the same part of the world as the places you book.
                </p>

                <p className="text-slate-700 mb-4">
                    We help you book direct with local hosts and local providers, and we don&apos;t add a
                    guest booking fee. The price you see is the price you pay. Booking direct keeps more of
                    what you spend with the people who own and run the cottages, and with the local
                    businesses behind the experiences you add to a stay.
                </p>

                <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">
                    Galloway and Southern Ayrshire UNESCO Biosphere
                </h2>
                <p className="text-slate-700 mb-4">
                    We are a Proud Supporter of the{' '}
                    <a
                        href="https://www.gsabiosphere.org.uk"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-700 underline"
                    >
                        Galloway and Southern Ayrshire UNESCO Biosphere
                    </a>
                    , and have signed up to its Biosphere Charter. The Charter is a commitment to look
                    after this special place &mdash; its landscape and wildlife, its communities, and the
                    local businesses that make a living here.
                </p>

                {biosphere && (
                    <a
                        href={biosphere.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={biosphere.alt}
                        className="not-prose inline-block mt-2 rounded-md transition hover:opacity-80"
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={biosphere.src}
                            alt={biosphere.alt}
                            width={biosphere.width}
                            height={biosphere.height}
                            className="h-28 w-auto"
                        />
                    </a>
                )}
            </div>
        </div>
    );
}
