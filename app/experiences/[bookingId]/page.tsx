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
        <div className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-12">
                <Link href="/trips" className="text-sm font-medium text-slate-500 hover:text-slate-800">
                    ← Your trips
                </Link>

                <header className="mt-4 mb-8 sm:mb-12 max-w-2xl">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                        Make more of your stay
                    </p>
                    <h1 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
                        Local experiences{town ? ' near ' + town : ''}
                    </h1>
                    <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
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
            className="group flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        >
            <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                {p.hero ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.hero} alt={`${who} — ${p.category}`} loading="lazy"
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-300">
                        <span className="text-4xl font-semibold">{who.slice(0, 1)}</span>
                    </div>
                )}
                <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-slate-700 backdrop-blur ring-1 ring-black/5">
                    {shapeCue(p.shape)}
                </span>
            </div>

            <div className="flex flex-1 flex-col p-4 sm:p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">{p.category}</p>
                <h2 className="mt-1 text-lg font-semibold leading-snug text-slate-900">{p.business_name}</h2>

                {/* Who you're booking, and the only honest trust signal we have:
                    how many bookings they've taken, or an "New here" tag rather
                    than an empty space that reads as "nobody has tried this". */}
                <div className="mt-2 flex items-center gap-2">
                    {p.headshot ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.headshot} alt="" className="h-6 w-6 flex-none rounded-full object-cover ring-1 ring-slate-200" />
                    ) : (
                        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
                            {who.slice(0, 1)}
                        </span>
                    )}
                    <span className="min-w-0 truncate text-xs text-slate-500">
                        {p.provider_name && p.provider_name.trim() ? p.provider_name : p.based_line || 'Local provider'}
                    </span>
                    <TrustBadge count={p.bookingsCount} />
                </div>

                {p.description ? (
                    <p className="mt-2 text-sm leading-relaxed text-slate-600 line-clamp-2">{p.description}</p>
                ) : null}

                <div className="mt-4 flex items-end justify-between gap-3 pt-1">
                    <div className="text-slate-900">
                        <span className="text-base font-semibold">{fromPriceLabel(p)}</span>
                    </div>
                    {p.shape === 'slot' ? (
                        <span className="text-xs text-slate-500">{nextSessionLabel(p)}</span>
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

// The trust tag. No stars yet — there are no provider reviews — so this is the
// honest version: a count of bookings taken, or "New here" when there are none.
function TrustBadge({ count }: { count: number }) {
    if (count > 0) {
        return (
            <span className="ml-auto flex-none rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/15">
                {count} booked
            </span>
        );
    }
    return (
        <span className="ml-auto flex-none rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
            New here
        </span>
    );
}

function Empty({ title, body }: { title: string; body: string }) {
    return (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-16 text-center">
            <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-500">{body}</p>
        </div>
    );
}
