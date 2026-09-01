import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadMarketplace, MpProvider } from '@/lib/experiencesData';
import { shapeCue } from '@/lib/serviceSlots';
import { townFromLocation, fromPriceLabel, nextSessionLabel } from '@/components/marketplace/present';

export const dynamic = 'force-dynamic';

// The marketplace — everything a guest can book for one of their stays, browsed
// as its own place rather than a strip on the trips page. Photography leads;
// each card is a door into a provider's listing page.
export default async function ExperiencesPage({ params }: { params: { bookingId: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/trips');

    const admin = adminClient();
    const mp = await loadMarketplace(admin, user.id, params.bookingId, guestExperiencesOpen());

    if (!mp.stay) redirect('/trips');
    const town = townFromLocation(mp.listing?.location);

    return (
        <div className="min-h-screen bg-stone-50">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
                <Link href="/trips" className="text-sm font-medium text-stone-500 hover:text-stone-800">
                    ← Your trips
                </Link>

                <header className="mt-4 mb-8 sm:mb-12 max-w-2xl">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                        Make more of your stay
                    </p>
                    <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">
                        Local experiences{town ? ' near ' + town : ''}
                    </h1>
                    <p className="mt-3 text-[15px] leading-relaxed text-stone-600">
                        People and places to book for your dates — booked and paid securely through
                        Galloway Getaways. The provider is who you’re booking; your card is only charged
                        when it’s confirmed.
                    </p>
                </header>

                {mp.open === false ? (
                    <Empty title="Coming soon to your stay"
                        body="We’re lining up chefs, bakers, saunas and guides near your cottage. Check back before you travel." />
                ) : mp.providers.length === 0 ? (
                    <Empty title="Nothing near this cottage yet"
                        body="No providers cover this spot for your dates just now. It’s a new part of the site and filling in fast." />
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
                        {mp.providers.map((p) => (
                            <Card key={p.id} bookingId={params.bookingId} p={p} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function Card({ bookingId, p }: { bookingId: string; p: MpProvider }) {
    const who = (p.provider_name && p.provider_name.trim()) || p.business_name;
    return (
        <Link
            href={`/experiences/${bookingId}/${p.id}`}
            className="group flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200/80 shadow-sm transition hover:shadow-md hover:ring-stone-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        >
            <div className="relative aspect-[4/3] overflow-hidden bg-stone-100">
                {p.hero ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.hero} alt={`${who} — ${p.category}`} loading="lazy"
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                ) : (
                    <div className="flex h-full w-full items-center justify-center text-stone-300">
                        <span className="text-4xl font-semibold">{who.slice(0, 1)}</span>
                    </div>
                )}
                <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-stone-700 backdrop-blur ring-1 ring-black/5">
                    {shapeCue(p.shape)}
                </span>
            </div>

            <div className="flex flex-1 flex-col p-4 sm:p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">{p.category}</p>
                <h2 className="mt-1 text-lg font-semibold leading-snug text-stone-900">{p.business_name}</h2>
                {p.based_line ? <p className="mt-0.5 text-sm text-stone-500">{p.based_line}</p> : null}
                {p.description ? (
                    <p className="mt-2 text-sm leading-relaxed text-stone-600 line-clamp-2">{p.description}</p>
                ) : null}

                <div className="mt-4 flex items-end justify-between gap-3 pt-1">
                    <div className="text-stone-900">
                        <span className="text-base font-semibold">{fromPriceLabel(p)}</span>
                    </div>
                    {p.shape === 'slot' ? (
                        <span className="text-xs text-stone-500">{nextSessionLabel(p)}</span>
                    ) : (
                        <span className="text-xs font-medium text-emerald-700 opacity-0 transition group-hover:opacity-100">
                            View →
                        </span>
                    )}
                </div>
            </div>
        </Link>
    );
}

function Empty({ title, body }: { title: string; body: string }) {
    return (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-16 text-center">
            <h3 className="text-lg font-semibold text-stone-800">{title}</h3>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-stone-500">{body}</p>
        </div>
    );
}
