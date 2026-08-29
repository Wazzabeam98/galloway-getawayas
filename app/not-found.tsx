import Link from 'next/link';
import type { Metadata } from 'next';

// A 404 is not the home page and is not worth indexing.
//
// Next emits its own `noindex` for this route, and the root layout was adding
// a second robots tag saying `index, follow` on top of it, plus a canonical
// pointing at `/`. Saying it here explicitly replaces the inherited pair
// rather than arguing with it.
export const metadata: Metadata = {
    title: 'Page not found',
    robots: { index: false, follow: false },
};

// A guest following an old link to a listing that has been removed or hidden
// ends up here, so it should read like a dead end with a way out rather than
// an error.
export default function NotFound() {
    return (
        <div className="max-w-lg mx-auto px-6 py-20 text-center">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-3">
                We couldn&apos;t find that page
            </h1>
            <p className="text-slate-600 mb-8">
                It may have moved, or the place you&apos;re looking for might no longer be listed
                with us.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
                <Link
                    href="/"
                    className="px-5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition"
                >
                    Find a place to stay
                </Link>
                <Link
                    href="/trips"
                    className="px-5 py-3 border border-slate-300 hover:border-slate-900 text-slate-800 text-sm font-semibold rounded-xl transition"
                >
                    Your trips
                </Link>
            </div>

            <p className="text-xs text-slate-400 mt-10">
                If you followed a link from an email and expected it to work, let us know at
                hello@gallowaygetaways.co.uk.
            </p>
        </div>
    );
}
