import Link from 'next/link';
import { shapeCue } from '@/lib/serviceSlots';
import { dietaryOptionLabel } from '@/lib/serviceProviders';
import {
    itemPriceLabel, cancellationSentence, coverageLabel,
    durationLabel, durationSummary, yearsLabel, groupSizeLabel,
} from '@/components/marketplace/present';
import { MapPin, Clock, Users, User, BadgeCheck, Award, Star } from 'lucide-react';
import PhotoGallery from '@/components/PhotoGallery';
import ReviewStars from '@/components/ReviewStars';
import ProviderReplyBox from '@/components/marketplace/ProviderReplyBox';
import { capitializeFirst } from '@/lib/utils';
import type { MpProvider } from '@/lib/experiencesData';
import type { ExperienceReviewsBlock } from '@/lib/experienceReviews';

// The listing body, in the cottage-page craft (photo mosaic, facts icon-list,
// section rhythm). Shared by the against-a-stay page and the public/standalone
// page so both read as one listing; the caller passes the right-hand `panel` (the
// stay booking panel, the standalone one, or the honest "book with a stay"
// notice). A plain server component. Rules: first name only, no address before
// payment. Reviews (`reviews`) render only once at least one exists — a brand-new
// listing shows no section at all and leans on the Verified badge; the average is
// withheld until there are enough of them to mean something (see lib/reviews).
export default function ExperienceListingBody({
    p, backHref, backLabel, panel, reviews,
}: {
    p: MpProvider;
    backHref: string;
    backLabel: string;
    panel: React.ReactNode;
    reviews?: ExperienceReviewsBlock | null;
}) {
    const who = p.byline || p.business_name;
    const town = p.based_line || coverageLabel(p);

    const duration = durationSummary(p);
    const groupSize = groupSizeLabel(p.maxGuests);
    // The professional title reads as the host's "who they are" line, unless it
    // would only echo the heading (a provider whose business_name is still their
    // professional title, before a distinct listing name exists).
    const proTitle = p.professional_title && p.professional_title.trim()
        && p.professional_title.trim().toLowerCase() !== p.business_name.trim().toLowerCase()
        ? p.professional_title.trim()
        : null;

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
                <Link href={backHref} className="text-sm font-medium text-slate-500 hover:text-slate-800">
                    ← {backLabel}
                </Link>

                {p.galleryKeys.length ? (
                    <PhotoGallery images={p.galleryKeys} title={p.business_name} area={town || undefined} mobileStrip />
                ) : (
                    <div className="my-4 flex h-[300px] w-full items-center justify-center rounded-2xl bg-slate-100 text-5xl font-semibold text-slate-300 md:h-[460px]">
                        {who.slice(0, 1)}
                    </div>
                )}

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 lg:gap-10 mt-2 pb-12">
                    <div className="lg:col-span-2 min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">{p.category}</p>
                        <h1 className="mt-1.5 text-2xl md:text-3xl font-bold text-slate-900">{p.business_name}</h1>
                        <span className="mt-2 inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                            {shapeCue(p.shape)}
                        </span>

                        {p.description ? (
                            <p className="mt-5 whitespace-pre-line text-base md:text-lg leading-relaxed text-slate-700">{p.description}</p>
                        ) : null}

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

                        {p.what_happens ? (
                            <section className="mt-8 border-t border-slate-200 pt-8">
                                <h2 className="text-xl md:text-2xl font-bold text-slate-900">What happens</h2>
                                <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{p.what_happens}</p>
                            </section>
                        ) : null}

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

                        {reviews && reviews.count > 0 && (
                            <section className="mt-8 border-t border-slate-200 pt-8">
                                <div className="flex items-baseline gap-2.5">
                                    <h2 className="text-xl md:text-2xl font-bold text-slate-900">Reviews</h2>
                                    {reviews.avg !== null ? (
                                        <span className="flex items-baseline gap-1.5 text-slate-900">
                                            <Star className="h-4 w-4 self-center fill-amber-400 text-amber-400" aria-hidden />
                                            <span className="text-lg font-semibold">{reviews.avg.toFixed(2)}</span>
                                            <span className="text-sm text-slate-500">
                                                · {reviews.count} review{reviews.count > 1 ? 's' : ''}
                                            </span>
                                        </span>
                                    ) : (
                                        <span className="text-sm text-slate-500">
                                            {reviews.count} review{reviews.count > 1 ? 's' : ''} so far
                                        </span>
                                    )}
                                </div>

                                <ul className="mt-5 space-y-6">
                                    {reviews.items.map((r) => (
                                        <li key={r.id} className="border-b border-slate-100 pb-6 last:border-0 last:pb-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-slate-900">{capitializeFirst(r.firstName || 'Guest')}</span>
                                                <ReviewStars value={r.rating} size={14} />
                                                {r.itemName ? (
                                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                                        {r.itemName}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{r.comment}</p>
                                            <ProviderReplyBox
                                                reviewId={r.id}
                                                existingReply={r.reply}
                                                providerFirstName={reviews.providerFirstName}
                                                canReply={reviews.canReply}
                                            />
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                    </div>

                    <div className="lg:sticky lg:top-6 lg:self-start">{panel}</div>
                </div>
            </div>
        </div>
    );
}
