'use client';

import { useEffect } from 'react';
import Link from 'next/link';

// Shown when something throws. A guest who has just tried to book and hit this
// needs to know whether their money is safe, not a stack trace.
export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[unhandled]', error);
    }, [error]);

    return (
        <div className="max-w-lg mx-auto px-6 py-20 text-center">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-3">
                Something went wrong at our end
            </h1>
            <p className="text-slate-600 mb-2">
                Sorry about that. It&apos;s us, not you, and it&apos;s usually temporary.
            </p>
            <p className="text-slate-600 mb-8">
                If you were in the middle of paying, nothing will have been taken twice — check
                your trips before trying again.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                    type="button"
                    onClick={reset}
                    className="px-5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition"
                >
                    Try again
                </button>
                <Link
                    href="/"
                    className="px-5 py-3 border border-slate-300 hover:border-slate-900 text-slate-800 text-sm font-semibold rounded-xl transition"
                >
                    Back to the home page
                </Link>
                <Link
                    href="/trips"
                    className="px-5 py-3 text-sm font-semibold text-slate-600 hover:text-slate-900"
                >
                    Your trips
                </Link>
            </div>

            <p className="text-xs text-slate-400 mt-10">
                Still stuck? Email hello@gallowaygetaways.co.uk and we&apos;ll sort it.
                {error.digest && <span className="block mt-1">Reference: {error.digest}</span>}
            </p>
        </div>
    );
}
