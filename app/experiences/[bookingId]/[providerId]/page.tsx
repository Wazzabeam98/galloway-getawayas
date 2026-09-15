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
import { MapPin, Clock, Users, BadgeCheck, Award } from 'lucide-react';
import BookingPanel from '@/components/marketplace/BookingPanel';

export const dynamic = 'force-dynamic';

// A provider's listing page — the room the trip page never had. Airbnb's shape,
// our data and our rules: the gallery leads on the work, the person is shown by
// first name only (never a surname), the credentials they gave at sign-up are
// finally surfaced, and the booking box already knows the guest's stay dates
// (this is reached from inside a cottage booking, not a standalone date search).
//
// Every section renders only when its data exists, so a thin provider — one
// photo and a sentence — reads as a deliberate, quiet page rather than a form
// with blanks. What we don't hold (an itinerary, a what-to-bring list, reviews,
// a public address before payment) is simply absent, never faked.
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

    // The person a guest is booking — their first name only (never a surname),
    // for the byline and image alts. Falls back to the Title, never to a stored
    // name snapshot.
    const who = p.byline || p.business_name;

    // The gallery leads on the provider's own photos (the dedicated "show guests
    // what it looks like" step); item images supplement them. Deduped, so a menu
    // photo reused as a hero doesn't appear twice.
    const gallery = Array.from(new Set([
        ...p.photos,
        ...p.items.map((i) => i.image).filter(Boolean) as string[],
    ]));
    const single = gallery.length === 1;

    // The header highlights — Airbnb's icon row, but only the facts we hold. Each
    // is dropped when absent, so the row never shows an empty slot.
    const duration = durationSummary(p);
    const where = p.based_line || coverageLabel(p);
    const groupSize = groupSizeLabel(p.maxGuests);

    // The person's professional title — a credential, shown in the About block
    // beneath their name. The h1 is the listing title (business_name) now, so
    // this reads as "who they are", not a repeat of the heading. Hidden when it
    // would only echo the h1 — an existing provider whose business_name is still
    // their professional title (they predate the listing-title question) would
    // otherwise show the same words twice until they name their experience.
    const proTitle = p.professional_title && p.professional_title.trim()
        && p.professional_title.trim().toLowerCase() !== p.business_name.trim().toLowerCase()
        ? p.professional_title.trim()
        : null;

    // Is there anything to say ABOUT the person beyond their name and face? The
    // About block leads with the credentials they gave; with none of them it
    // collapses to a quiet "Meet {first name}" rather than an empty heading.
    const years = yearsLabel(p.yearsExperience);
    const hasCreds = Boolean(proTitle || years || p.qualifications || p.recognition);

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-5 sm:pt-6">
                <Link href={`/experiences/${params.bookingId}`} className="text-sm font-medium text-slate-500 hover:text-slate-800">
                    ← All experiences
                </Link>
            </div>

            {/* Gallery. Mobile: a swipeable strip that reads as a single hero when
                there's one photo. Desktop: a mosaic that collapses to one framed
                image at a single photo. No cover crop invented — every image is
                one the provider uploaded. */}
            <div className="mt-4">
                {gallery.length ? (
                    <>
                        <div className="sm:hidden flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            {gallery.map((src, i) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={src} src={src} alt={i === 0 ? who : ''} loading={i === 0 ? 'eager' : 'lazy'}
                                    className={`aspect-[4/3] flex-none snap-center rounded-2xl object-cover ${single ? 'w-full' : 'w-[86%]'}`} />
                            ))}
                        </div>
                        <div className="mx-auto hidden max-w-6xl px-6 sm:block">
                            <div className={`grid gap-2 overflow-hidden rounded-2xl ${single ? 'grid-cols-1' : 'grid-cols-4'}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={gallery[0]} alt={who} loading="eager"
                                    className={`w-full object-cover ${single ? 'aspect-[16/7]' : 'col-span-2 row-span-2 aspect-square'}`} />
                                {!single && gallery.slice(1, 5).map((src) => (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img key={src} src={src} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                                ))}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="mx-auto max-w-6xl px-4 sm:px-6">
                        <div className="flex aspect-[16/9] w-full items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                            <span className="text-6xl font-semibold">{who.slice(0, 1)}</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="mx-auto max-w-6xl px-4 sm:px-6 py-7 sm:py-10">
                <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px] lg:gap-12">
                    {/* Left — who and what */}
                    <div className="min-w-0">
                        {/* Identity. The heading is the LISTING title (business_name)
                            — what the experience is called. The person's professional
                            title is a credential in the About block below, not the
                            heading. (A provider who predates the listing-title
                            question still has their professional title in
                            business_name; the About block dedupes so it isn't shown
                            twice until they name their experience.) */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">{p.category}</p>
                            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                                {shapeCue(p.shape)}
                            </span>
                        </div>
                        <h1 className="mt-2 text-[26px] leading-tight sm:text-4xl font-semibold tracking-tight text-slate-900">
                            {p.business_name}
                        </h1>

                        {/* Highlights — the facts a guest scans first. Only the ones
                            we hold; a chef with no duration simply doesn't show one. */}
                        {(duration || where || groupSize) && (
                            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                                {duration && (
                                    <li className="flex items-center gap-1.5">
                                        <Clock className="h-4 w-4 flex-none text-slate-400" aria-hidden />{duration}
                                    </li>
                                )}
                                {where && (
                                    <li className="flex items-center gap-1.5">
                                        <MapPin className="h-4 w-4 flex-none text-slate-400" aria-hidden />{where}
                                    </li>
                                )}
                                {groupSize && (
                                    <li className="flex items-center gap-1.5">
                                        <Users className="h-4 w-4 flex-none text-slate-400" aria-hidden />{groupSize}
                                    </li>
                                )}
                            </ul>
                        )}

                        {p.description ? (
                            <p className="mt-6 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{p.description}</p>
                        ) : null}

                        {/* About {first name} — the person, within our first-name,
                            no-standalone-profile frame. Leads with the credentials
                            they gave at sign-up (finally surfaced); with none it is
                            a quiet introduction, still deliberate, never a blank. */}
                        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
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
                                    <h2 className="text-base font-semibold text-slate-900">
                                        {p.byline ? 'Meet ' + p.byline : 'Your host'}
                                    </h2>
                                    {/* The professional title, then years — the
                                        "who they are" line beneath their name. */}
                                    {proTitle ? (
                                        <p className="text-sm font-medium text-slate-700">{proTitle}</p>
                                    ) : null}
                                    {years ? (
                                        <p className="text-sm text-slate-500">{years}</p>
                                    ) : (!proTitle && p.based_line) ? (
                                        <p className="text-sm text-slate-500">{p.based_line}</p>
                                    ) : null}
                                </div>
                                <span className="ml-auto flex-none inline-flex items-center gap-1 self-start rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/15">
                                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified business
                                </span>
                            </div>

                            {p.qualifications ? (
                                <div className="mt-4">
                                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        <Award className="h-3.5 w-3.5 text-slate-400" aria-hidden /> Training &amp; qualifications
                                    </h3>
                                    <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700">{p.qualifications}</p>
                                </div>
                            ) : null}

                            {p.recognition ? (
                                <div className="mt-4">
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recognition</h3>
                                    <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-700">{p.recognition}</p>
                                </div>
                            ) : null}

                            {!hasCreds && (
                                <p className="mt-3 text-sm leading-relaxed text-slate-500">
                                    {p.byline || 'This provider'} is a Galloway Getaways verified business — someone we&apos;ve
                                    approved to host guests.
                                </p>
                            )}
                        </section>

                        {/* What happens — the provider's own walk-through, when they
                            wrote one. (We capture a paragraph, not a step-by-step
                            itinerary — see the presentation scope — so this is prose,
                            and absent it, the section is gone rather than empty.) */}
                        {p.what_happens ? (
                            <div className="mt-8">
                                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">What happens</h2>
                                <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{p.what_happens}</p>
                            </div>
                        ) : null}

                        {/* The menu — what's included, each with its photo, price and
                            (where it's a timed treatment) its length. A slot's single
                            offering is shown in the panel with its times, not here. */}
                        {p.shape !== 'slot' && (
                            <div className="mt-8">
                                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                                    {p.items.length > 1 ? 'What’s included' : 'What you get'}
                                </h2>
                                <ul className="mt-3 divide-y divide-slate-200 rounded-2xl bg-white ring-1 ring-slate-200/80">
                                    {p.items.map((it) => {
                                        const dur = durationLabel(it.duration_minutes);
                                        return (
                                            <li key={it.id} className="flex gap-4 p-4">
                                                {it.image ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={it.image} alt="" loading="lazy" className="h-16 w-16 flex-none rounded-lg object-cover" />
                                                ) : null}
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-baseline justify-between gap-3">
                                                        <span className="font-medium text-slate-900">{it.name}</span>
                                                        <span className="whitespace-nowrap font-semibold text-slate-900">{itemPriceLabel(it.price, it.unit)}</span>
                                                    </div>
                                                    {dur ? (
                                                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                                                            <Clock className="h-3.5 w-3.5 flex-none" aria-hidden />{dur}
                                                        </p>
                                                    ) : null}
                                                    {it.description ? <p className="mt-0.5 text-sm text-slate-500">{it.description}</p> : null}
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}

                        {/* Allergies & dietary — food only. Silence is the failure
                            mode: a guest reading nothing assumes it's fine. So when
                            the provider hasn't said, the listing says THAT, plainly,
                            and points the guest at the allergy field. */}
                        {p.isFood && (
                            <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-4">
                                <h3 className="text-sm font-semibold text-slate-900">Allergies &amp; dietary</h3>
                                {(p.dietary_options.length > 0 || p.dietary_note) ? (
                                    <>
                                        {p.dietary_options.length > 0 && (
                                            <ul className="mt-2 flex flex-wrap gap-2">
                                                {p.dietary_options.map((k) => (
                                                    <li key={k} className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                                                        {dietaryOptionLabel(k)}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {p.dietary_note ? (
                                            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">{p.dietary_note}</p>
                                        ) : null}
                                    </>
                                ) : (
                                    <p className="mt-1 text-sm leading-relaxed text-slate-500">
                                        {who} hasn’t said what they can cater for. Add any allergy or dietary need when
                                        you book{p.shape === 'slot'
                                            ? ' — they’ll see it with your booking.'
                                            : ' and they’ll confirm if they can cater for it.'}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Good to know — Airbnb's "Things to know", built only from
                            facts we hold: duration, group size, where (coverage now,
                            exact address after payment — our privacy rule), and the
                            cancellation terms in plain words. What-to-bring and an
                            age/activity level aren't captured yet, so those rows are
                            absent rather than blank. */}
                        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
                            <h3 className="text-sm font-semibold text-slate-900">Good to know</h3>
                            <dl className="mt-3 space-y-3 text-sm">
                                {duration && (
                                    <Row term="Duration">{duration}</Row>
                                )}
                                {groupSize && (
                                    <Row term="Group size">{groupSize}</Row>
                                )}
                                {(coverageLabel(p) || where) && (
                                    <Row term="Where">
                                        {coverageLabel(p)
                                            ? 'Covers ' + coverageLabel(p)
                                            : 'Around ' + where}. The exact address is shared once your booking is paid.
                                    </Row>
                                )}
                                <Row term="Cancellation">
                                    {cancellationSentence(p.shape, p.cancellation_window_hours, who)}
                                </Row>
                            </dl>
                        </div>
                    </div>

                    {/* Right — the booking panel, sticky on desktop */}
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

// One labelled fact in "Good to know" — a term above its value, stacked so a long
// cancellation sentence reads cleanly on a phone.
function Row({ term, children }: { term: string; children: React.ReactNode }) {
    return (
        <div>
            <dt className="font-medium text-slate-900">{term}</dt>
            <dd className="mt-0.5 leading-relaxed text-slate-600">{children}</dd>
        </div>
    );
}
