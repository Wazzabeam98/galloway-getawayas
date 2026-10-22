import Link from 'next/link';

// The home-page "Refer a host" band, styled like "Run an experience?"
// (ExperiencesForBusinesses): a white card on the page's stone tint,
// its own heading, a lead line, and a stone-900 CTA. No decorative image stack —
// nothing to show and the repo holds no raster blobs.
export function ReferHostBand() {
    return (
        <section className="mt-16 pt-10 border-t border-stone-200">
            <div className="rounded-2xl bg-white border border-stone-200 p-6 sm:p-10">
                <div className="max-w-xl">
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900">
                        Refer a host, earn cash
                    </h2>
                    <p className="mt-3 text-stone-600 leading-relaxed">
                        Know someone with a holiday let, experience or service? Refer them and earn
                        up to £50 when they get going — and they pay no commission on their first
                        booking.
                    </p>
                    <Link
                        href="/refer"
                        className="mt-6 inline-flex items-center rounded-lg bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
                    >
                        Refer a host
                    </Link>
                </div>
            </div>
        </section>
    );
}
