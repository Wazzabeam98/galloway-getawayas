import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadMarketplace, pickProvider } from '@/lib/experiencesData';
import { shapeCue } from '@/lib/serviceSlots';
import { itemPriceLabel, unitPhrase, cancellationSentence } from '@/components/marketplace/present';
import BookingPanel from '@/components/marketplace/BookingPanel';

export const dynamic = 'force-dynamic';

// A provider's listing page — the room the trip page never had. Their gallery,
// who they are, the whole menu or the week of times, the cancellation policy in
// plain words, and a booking panel that fits the shape.
export default async function ListingPage(
    { params }: { params: { bookingId: string; providerId: string } }
) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/trips');

    const admin = adminClient();
    const mp = await loadMarketplace(admin, user.id, params.bookingId, guestExperiencesOpen());
    if (!mp.stay) redirect('/trips');
    const p = pickProvider(mp, params.providerId);
    if (!p) redirect(`/experiences/${params.bookingId}`);

    const who = (p.provider_name && p.provider_name.trim()) || p.business_name;
    const gallery = Array.from(new Set(p.items.map((i) => i.image).filter(Boolean))) as string[];

    return (
        <div className="min-h-screen bg-stone-50">
            {/* Gallery — the listing leads on the work. One good image fills the
                width; a set becomes a framed strip beside the lead. */}
            <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6">
                <Link href={`/experiences/${params.bookingId}`} className="text-sm font-medium text-stone-500 hover:text-stone-800">
                    ← All experiences
                </Link>
            </div>

            <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-4">
                {gallery.length ? (
                    <div className={`grid gap-2 overflow-hidden rounded-2xl ${gallery.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-4'}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={gallery[0]} alt={who} loading="eager"
                            className={`w-full object-cover ${gallery.length === 1 ? 'aspect-[16/9]' : 'col-span-2 sm:col-span-2 sm:row-span-2 aspect-square sm:aspect-auto sm:h-full'}`} />
                        {gallery.slice(1, 5).map((src) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={src} src={src} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                        ))}
                    </div>
                ) : (
                    <div className="flex aspect-[16/9] w-full items-center justify-center rounded-2xl bg-stone-100 text-stone-300">
                        <span className="text-6xl font-semibold">{who.slice(0, 1)}</span>
                    </div>
                )}
            </div>

            <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 sm:py-10">
                <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_360px]">
                    {/* Left — who and what */}
                    <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">{p.category}</p>
                        <h1 className="mt-1.5 text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">{p.business_name}</h1>

                        <div className="mt-4 flex items-center gap-3">
                            {p.headshot ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.headshot} alt={who} className="h-12 w-12 rounded-full object-cover ring-1 ring-stone-200" />
                            ) : null}
                            <div>
                                {p.provider_name && p.provider_name !== p.business_name ? (
                                    <div className="font-medium text-stone-800">{p.provider_name}</div>
                                ) : null}
                                {p.based_line ? <div className="text-sm text-stone-500">{p.based_line}</div> : null}
                            </div>
                            <span className="ml-auto rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">
                                {shapeCue(p.shape)}
                            </span>
                        </div>

                        {p.description ? (
                            <p className="mt-6 whitespace-pre-line text-[15px] leading-relaxed text-stone-700">{p.description}</p>
                        ) : null}

                        {/* The menu — the whole list, each with its photo, for a
                            provider that makes things. A slot's single offering is
                            shown in the panel with its times, so it isn't repeated
                            here. */}
                        {p.shape !== 'slot' && (
                            <div className="mt-8">
                                <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
                                    {p.items.length > 1 ? 'The menu' : 'What you get'}
                                </h2>
                                <ul className="mt-3 divide-y divide-stone-200 rounded-2xl bg-white ring-1 ring-stone-200/80">
                                    {p.items.map((it) => (
                                        <li key={it.id} className="flex gap-4 p-4">
                                            {it.image ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={it.image} alt="" loading="lazy" className="h-16 w-16 flex-none rounded-lg object-cover" />
                                            ) : <div className="h-16 w-16 flex-none rounded-lg bg-stone-100" />}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-baseline justify-between gap-3">
                                                    <span className="font-medium text-stone-900">{it.name}</span>
                                                    <span className="whitespace-nowrap font-semibold text-stone-900">{itemPriceLabel(it.price, it.unit)}</span>
                                                </div>
                                                {it.description ? <p className="mt-0.5 text-sm text-stone-500">{it.description}</p> : null}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="mt-8 rounded-2xl border border-stone-200 bg-white p-4">
                            <h3 className="text-sm font-semibold text-stone-900">Cancellation</h3>
                            <p className="mt-1 text-sm leading-relaxed text-stone-600">
                                {cancellationSentence(p.shape, p.cancellation_window_hours, who)}
                            </p>
                        </div>
                    </div>

                    {/* Right — the booking panel, sticky on desktop */}
                    <div className="lg:sticky lg:top-6 lg:self-start">
                        <BookingPanel
                            bookingId={params.bookingId}
                            checkIn={mp.stay.check_in}
                            checkOut={mp.stay.check_out}
                            provider={{
                                id: p.id,
                                business_name: p.business_name,
                                who,
                                shape: p.shape,
                                items: p.items,
                                sessions: p.sessions,
                                leadTimeDays: p.lead_time_days,
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
