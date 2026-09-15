import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadMarketplace, pickProvider } from '@/lib/experiencesData';
import { shapeCue } from '@/lib/serviceSlots';
import { dietaryOptionLabel } from '@/lib/serviceProviders';
import {
    itemPriceLabel, cancellationSentence, coverageLabel,
    durationLabel, durationSummary, yearsLabel, groupSizeLabel,
} from '@/components/marketplace/present';
import { MapPin, Clock, Users, User, BadgeCheck, Award } from 'lucide-react';
import PhotoGallery from '@/components/PhotoGallery';
import BookingPanel from '@/components/marketplace/BookingPanel';

export const dynamic = 'force-dynamic';

// A provider's listing page, in the same shape and the same craft as a cottage
// listing (app/homes/[id]) — the photo mosaic, the type scale, the section
// rhythm — so the two read as one site. The eye goes photos → title →
// description → facts → detail. Our rules hold: first name only (never a
// surname), no ratings or review counts, no public address before payment.
//
// Every section renders only when its data exists, so a thin provider — one
// photo and a sentence — is a deliberate, quiet page, not a form with blanks.
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

    const who = p.byline || p.business_name;
    const town = p.based_line || coverageLabel(p);

    // The facts a guest scans in a second — only the ones we hold.
    const duration = durationSummary(p);
    const groupSize = groupSizeLabel(p.maxGuests);
    // The professional title reads as the host's "who they are" line, unless it
    // would only echo the heading (a provider whose business_name is still their
    // professional title, before a distinct listing name exists).
    const proTitle = p.professional_title && p.professional_title.trim()
        && p.professional_title.trim().toLowerCase() !== p.business_name.trim().toLowerCase()
        ? p.professional_title.trim()
        : null;

    // The fuller "About" prose — credentials in their own words. Shown as its own
    // section only when there is something to say beyond the facts line.
    const years = yearsLabel(p.yearsExperience);
    const hasAbout = Boolean(years || p.qualifications || p.recognition);

    const facts: { icon: React.ReactNode; value: string; label: string }[] = [];
    if (p.byline) facts.push({ icon: <User className="h-5 w-5 text-slate-700" aria-hidden />, value: p.byline, label: proTitle || 'Your host' });
    if (duration) facts.push({ icon: <Clock className="h-5 w-5 text-slate-700" aria-hidden />, value: duration, label: 'Duration' });
    if (town) facts.push({ icon: <MapPin className="h-5 w-5 text-slate-700" aria-hidden />, value: town, label: 'Where it happens' });
    if (groupSize) facts.push({ icon: <Users className="h-5 w-5 text-slate-700" aria-hidden />, value: groupSize, label: 'Group size' });

    return (
        <div className="min-h-screen bg-white">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-5 sm:pt-6">
                <Link href={`/experiences/${params.bookingId}`} className="text-sm font-medium text-slate-500 hover:text-slate-800">
                    ← All experiences
                </Link>

                {/* Photos lead — the same mosaic component a cottage listing uses; a
                    swipeable strip on a phone, a single framed image at one photo. */}
                {p.galleryKeys.length ? (
                    <PhotoGallery images={p.galleryKeys} title={p.business_name} area={town || undefined} mobileStrip />
                ) : (
                    <div className="my-4 flex h-[300px] w-full items-center justify-center rounded-2xl bg-slate-100 text-5xl font-semibold text-slate-300 md:h-[460px]">
                        {who.slice(0, 1)}
                    </div>
                )}

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 lg:gap-10 mt-2 pb-12">
                    {/* Left — who and what. First in source order, so on a phone the
                        hierarchy is photos → title → description → facts → detail,
                        with the booking box below (its own sticky bar is the CTA). */}
                    <div className="lg:col-span-2 min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">{p.category}</p>
                        <h1 className="mt-1.5 text-2xl md:text-3xl font-bold text-slate-900">{p.business_name}</h1>
                        <span className="mt-2 inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                            {shapeCue(p.shape)}
                        </span>

                        {/* The description breathes — the sentence a guest decides on. */}
                        {p.description ? (
                            <p className="mt-5 whitespace-pre-line text-base md:text-lg leading-relaxed text-slate-700">{p.description}</p>
                        ) : null}

                        {/* Facts — icon, bold value, grey label. Scannable in a second;
                            replaces the old stack of bordered cards. */}
                        {facts.length > 0 && (
                            <dl className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 border-t border-slate-200 pt-7">
                                {facts.map((f, i) => (
                                    <div key={i} className="flex items-start gap-3">
                                        <span className="mt-0.5 flex-none">{f.icon}</span>
                                        <div className="min-w-0">
                                            <dd className="font-semibold text-slate-900 leading-tight">{f.value}</dd>
                                            <dt className="text-sm text-slate-500">{f.label}</dt>
                                        </div>
                                    </div>
                                ))}
                            </dl>
                        )}

                        {/* About {first name} — the fuller credentials, in their own
                            words. Absent (not a fallback card) when there's nothing
                            beyond the facts line above. */}
                        {hasAbout && (
                            <section className="mt-8 border-t border-slate-200 pt-8">
                                <div className="flex items-center gap-3">
                                    {p.headshot ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={p.headshot} alt={who} className="h-14 w-14 flex-none rounded-full object-cover ring-1 ring-slate-200" />
                                    ) : (
                                        <span className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-500">
                                            {who.slice(0, 1)}
                                        </span>
                                    )}
                                    <div className="min-w-0">
                                        <h2 className="text-xl md:text-2xl font-bold text-slate-900">
                                            {p.byline ? 'Meet ' + p.byline : 'Your host'}
                                        </h2>
                                        {years ? <p className="text-sm text-slate-500">{years}</p> : null}
                                    </div>
                                    <span className="ml-auto flex-none inline-flex items-center gap-1 self-start rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/15">
                                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified business
                                    </span>
                                </div>

                                {p.qualifications ? (
                                    <div className="mt-5">
                                        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            <Award className="h-3.5 w-3.5 text-slate-400" aria-hidden /> Training &amp; qualifications
                                        </h3>
                                        <p className="mt-1.5 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{p.qualifications}</p>
                                    </div>
                                ) : null}

                                {p.recognition ? (
                                    <div className="mt-5">
                                        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recognition</h3>
                                        <p className="mt-1.5 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{p.recognition}</p>
                                    </div>
                                ) : null}
                            </section>
                        )}

                        {/* What happens — the provider's own walk-through, when they
                            wrote one. (No step-by-step itinerary; that needs new
                            wizard capture and is a separate piece.) */}
                        {p.what_happens ? (
                            <section className="mt-8 border-t border-slate-200 pt-8">
                                <h2 className="text-xl md:text-2xl font-bold text-slate-900">What happens</h2>
                                <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{p.what_happens}</p>
                            </section>
                        ) : null}

                        {/* The menu — what's included, each with its price and, where
                            it's a timed treatment, its length. A slot's single offering
                            is shown in the panel with its times, not here. */}
                        {p.shape !== 'slot' && (
                            <section className="mt-8 border-t border-slate-200 pt-8">
                                <h2 className="text-xl md:text-2xl font-bold text-slate-900">
                                    {p.items.length > 1 ? 'What’s included' : 'What you get'}
                                </h2>
                                <ul className="mt-4 divide-y divide-slate-100">
                                    {p.items.map((it) => {
                                        const dur = durationLabel(it.duration_minutes);
                                        return (
                                            <li key={it.id} className="flex gap-4 py-4 first:pt-0">
                                                {it.image ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={it.image} alt="" loading="lazy" className="h-16 w-16 flex-none rounded-xl object-cover" />
                                                ) : null}
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-baseline justify-between gap-3">
                                                        <span className="font-semibold text-slate-900">{it.name}</span>
                                                        <span className="whitespace-nowrap font-semibold text-slate-900">{itemPriceLabel(it.price, it.unit)}</span>
                                                    </div>
                                                    {dur ? (
                                                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                                                            <Clock className="h-3.5 w-3.5 flex-none" aria-hidden />{dur}
                                                        </p>
                                                    ) : null}
                                                    {it.description ? <p className="mt-1 text-sm leading-relaxed text-slate-600">{it.description}</p> : null}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>
                        )}

                        {/* Allergies & dietary — food only. Silence is the failure
                            mode, so when they've said nothing, say THAT and point the
                            guest at the allergy field. */}
                        {p.isFood && (
                            <section className="mt-8 border-t border-slate-200 pt-8">
                                <h2 className="text-xl md:text-2xl font-bold text-slate-900">Allergies &amp; dietary</h2>
                                {(p.dietary_options.length > 0 || p.dietary_note) ? (
                                    <>
                                        {p.dietary_options.length > 0 && (
                                            <ul className="mt-3 flex flex-wrap gap-2">
                                                {p.dietary_options.map((k) => (
                                                    <li key={k} className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                                                        {dietaryOptionLabel(k)}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {p.dietary_note ? (
                                            <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-slate-600">{p.dietary_note}</p>
                                        ) : null}
                                    </>
                                ) : (
                                    <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
                                        {who} hasn’t said what they can cater for. Add any allergy or dietary need when
                                        you book{p.shape === 'slot'
                                            ? ' — they’ll see it with your booking.'
                                            : ' and they’ll confirm if they can cater for it.'}
                                    </p>
                                )}
                            </section>
                        )}

                        {/* Cancellation, and the address-after-payment note — the
                            things a guest checks before committing. */}
                        <section className="mt-8 border-t border-slate-200 pt-8">
                            <h2 className="text-xl md:text-2xl font-bold text-slate-900">Cancellation</h2>
                            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
                                {cancellationSentence(p.shape, p.cancellation_window_hours, who)}
                            </p>
                            {town ? (
                                <p className="mt-3 flex items-start gap-1.5 text-sm text-slate-500">
                                    <MapPin className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
                                    <span>
                                        {coverageLabel(p) ? 'Covers ' + coverageLabel(p) : 'Around ' + town}. The exact address is shared once your booking is paid.
                                    </span>
                                </p>
                            ) : null}
                        </section>
                    </div>

                    {/* Right — the booking panel, sticky on desktop; below the detail
                        on a phone (the panel's own fixed bar is the mobile CTA). */}
                    <div className="lg:sticky lg:top-6 lg:self-start">
                        <BookingPanel
                            bookingId={params.bookingId}
                            checkIn={mp.stay.check_in}
                            checkOut={mp.stay.check_out}
                            cottageGuests={mp.stay.guests}
                            stay={{ title: mp.listing?.title || null, town: mp.listing?.location || null }}
                            provider={{
                                id: p.id,
                                business_name: p.business_name,
                                who,
                                shape: p.shape,
                                fulfilment: p.fulfilment,
                                isFood: p.isFood,
                                items: p.items,
                                sessions: p.sessions,
                                leadTimeDays: p.lead_time_days,
                                minPeople: p.minPeople,
                                slotCapacity: p.slotCapacity,
                                perItemDurations: p.perItemDurations,
                                turnaround: p.turnaround,
                                slotLength: p.slotLength,
                                slotAvailability: p.slotAvailability,
                                slotBlocks: p.slotBlocks,
                                partialBlocks: p.partialBlocks,
                                bookedBlocks: p.bookedBlocks,
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
