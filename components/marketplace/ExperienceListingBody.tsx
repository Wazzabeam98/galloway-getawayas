import Link from 'next/link';
import { shapeCue } from '@/lib/serviceSlots';
import { dietaryOptionLabel, accessibilityLabel, parkingLabel, experienceCancellationOption, experienceAmenityLabel } from '@/lib/serviceProviders';
import {
    itemPriceLabel, itemExtrasSubline, itemGuestRange, cancellationSentence, whereLine, locationTag, travelCoverageLine,
    durationLabel, durationSummary, yearsLabel, capacityLabel,
} from '@/components/marketplace/present';
import { unitMultiplies } from '@/lib/serviceOrders';
import { locationFromDirection } from '@/lib/orderLocation';
import { MapPin, Clock, Users, User, BadgeCheck, Compass, Flag, Activity, Backpack, ShieldAlert, Accessibility, Car, Check, ShoppingBag, Utensils, Package, Truck } from 'lucide-react';
import { experienceSteps, type StepIcon } from '@/lib/experienceSteps';
import PhotoGallery from '@/components/PhotoGallery';
import PropertyMap from '@/components/PropertyMap';
import ReviewStars from '@/components/ReviewStars';
import ShowAllReviews from '@/components/ShowAllReviews';
import ProviderReplyBox from '@/components/marketplace/ProviderReplyBox';
import HostCredentials from '@/components/marketplace/HostCredentials';
import { capitializeFirst } from '@/lib/utils';
import { MIN_PUBLIC_REVIEWS } from '@/lib/reviews';
import type { MpProvider } from '@/lib/experiencesData';
import type { ExperienceReviewsBlock } from '@/lib/experienceReviews';

// Icon for an itinerary phase, by its generic/real step key (see
// lib/experienceSteps). Titles are decided there — never per-category — so this
// maps only the fixed keys.
function phaseIcon(icon: StepIcon) {
    switch (icon) {
        case 'arrival': return MapPin;
        case 'finish': return Flag;
        case 'order': return ShoppingBag;
        case 'prep': return Utensils;
        case 'collect': return Package;
        case 'deliver': return Truck;
        default: return Compass;
    }
}

// The listing body, in the cottage-page craft (photo mosaic, facts icon-list,
// section rhythm). Shared by the against-a-stay page and the public/standalone
// page so both read as one listing; the caller passes the right-hand `panel` (the
// stay booking panel, the standalone one, or the honest "book with a stay"
// notice). A plain server component. Rules: first name only, no ratings/counts,
// no address before payment.
export default function ExperienceListingBody({
    p, backHref, backLabel, panel, reviews, menu, itemsMenu,
}: {
    p: MpProvider;
    backHref: string;
    backLabel: string;
    panel: React.ReactNode;
    // An INTERACTIVE menu (made-to-order food ordering): when passed it leads the
    // left column and replaces the static "What you get" list, so the menu, its
    // photos and prices are the main thing and the sidebar panel is the basket.
    menu?: React.ReactNode;
    // An interactive "What you get" for a comes-to-you experience — the same
    // items in the same slot, but each with a Choose button that opens the
    // booking dialog on that option. Replaces the static list in place.
    itemsMenu?: React.ReactNode;
    // Always passed by the listing pages; the section renders even at zero, with
    // an honest "No reviews yet" in place rather than dropping out.
    reviews?: ExperienceReviewsBlock;
}) {
    const who = p.byline || p.business_name;
    // Pre-payment location, per shape: a comes-to-you provider happens at the
    // guest's cottage; a fixed venue shows its town, never the old trades radius.
    // One definition, shared with the order page (lib/orderLocation). This used
    // to be its own expression here, and the two disagreed about a null
    // fulfilment: this page promised "the exact address is shared once your
    // booking is confirmed" and the order page then showed nothing.
    const comesToYou = locationFromDirection(p.shape, p.fulfilment).comesToCottage;
    const where = whereLine(p);
    const tag = locationTag(p);
    const travelCoverage = travelCoverageLine(p);
    const cancelPolicy = experienceCancellationOption(p.cancellation_window_hours, p.noRefund);

    const duration = durationSummary(p);
    // How big a group the experience holds. A SLOT sizes it from the capacity we
    // already resolve (item capacity, else the provider's slot_capacity) — the max
    // across its per-person options, or the room itself for a whole-session-only
    // provider — rather than maxGuests, which a slot leaves unset. Everyone else
    // keeps the maxGuests-based "Up to N guests".
    const isSlot = p.shape === 'slot';
    const slotCapacity = (() => {
        if (!isSlot) return 0;
        const perPersonCaps = (p.items || [])
            .filter((i) => unitMultiplies(i.unit))
            .map((i) => Number(i.capacity) || Number(p.slotCapacity) || 0);
        return perPersonCaps.length ? Math.max(...perPersonCaps) : (Number(p.slotCapacity) || 0);
    })();
    // Group size as a single provider-wide fact is shown only for a SLOT (the
    // session capacity). For a comes-to-you or made-to-order experience each item
    // states its OWN limit beside its price in "What you get" — a single "Up to N
    // guests" fact there would disagree with an item whose own maximum is lower.
    const groupSize = isSlot ? capacityLabel(slotCapacity) : '';
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
    if (where) facts.push({ icon: <MapPin className="h-5 w-5 text-slate-700" aria-hidden />, value: where, label: 'Where it happens' });
    if (groupSize) facts.push({ icon: <Users className="h-5 w-5 text-slate-700" aria-hidden />, value: groupSize, label: 'Group size' });
    // Optional, provider-picked (a fixed option, not prose). Accessibility leads
    // — a guest who needs it really needs it — then parking. They also help the
    // grid fill out.
    const accessLabel = accessibilityLabel(p.accessibility);
    const parkLabel = parkingLabel(p.parking);
    if (accessLabel) facts.push({ icon: <Accessibility className="h-5 w-5 text-slate-700" aria-hidden />, value: accessLabel, label: 'Accessibility' });
    if (parkLabel) facts.push({ icon: <Car className="h-5 w-5 text-slate-700" aria-hidden />, value: parkLabel, label: 'Parking' });
    // Three facts sit oddly in a two-column grid; give an exact three their own
    // single balanced row, and let four or more flow in the usual two columns.
    const factCols = facts.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-5 sm:pt-6">
                <Link href={backHref} className="text-sm font-medium text-slate-500 hover:text-slate-800">
                    ← {backLabel}
                </Link>

                {p.galleryKeys.length ? (
                    <PhotoGallery images={p.galleryKeys} title={p.business_name} area={tag || undefined} mobileStrip />
                ) : (
                    <div className="my-4 flex h-[300px] w-full items-center justify-center rounded-2xl bg-slate-100 text-5xl font-semibold text-slate-300 md:h-[460px]">
                        {who.slice(0, 1)}
                    </div>
                )}

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 lg:gap-10 mt-2">
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
                            <dl className={`mt-7 grid grid-cols-1 ${factCols} gap-x-6 gap-y-5 border-t border-slate-200 pt-7`}>
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

                        {/* The interactive menu leads for a food-ordering listing —
                            the main thing, above the host and the story. */}
                        {menu ? (
                            <section className="mt-8 border-t border-slate-200 pt-6">{menu}</section>
                        ) : null}

                        {hasAbout && (
                            <section className="mt-8 border-t border-slate-200 pt-6">
                                <div className="flex items-center gap-3">
                                    {p.headshot ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={p.headshot} alt={who} className="h-12 w-12 flex-none rounded-full object-cover ring-1 ring-slate-200" />
                                    ) : (
                                        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-slate-100 text-base font-semibold text-slate-500">
                                            {who.slice(0, 1)}
                                        </span>
                                    )}
                                    <div className="min-w-0">
                                        <h2 className="text-lg md:text-xl font-bold text-slate-900">
                                            {p.byline ? 'Hosted by ' + p.byline : 'Your host'}
                                        </h2>
                                        {years ? <p className="text-sm text-slate-500">{years}</p> : null}
                                    </div>
                                    <span className="ml-auto flex-none inline-flex items-center gap-1 self-start rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/15">
                                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified business
                                    </span>
                                </div>

                                {/* Credentials as quiet details under the name/years
                                    — a small muted icon, the line in normal weight and
                                    slightly smaller, no grey label beneath. Read as
                                    facts about the host, not headings. Shared with the
                                    order page's host card; an unfilled one is omitted. */}
                                <HostCredentials qualifications={p.qualifications} recognition={p.recognition} className="mt-5" />
                            </section>
                        )}

                        {/* What you get — directly under the host, above the story:
                            the items and prices are what the guest is deciding on, so
                            they lead. Omitted for a slot (its options live in the
                            booking panel) and for a food-ordering menu (the interactive
                            menu already leads the column). */}
                        {/* The interactive "What you get" (comes-to-you: each item
                            has a Choose button) replaces the static list in place. */}
                        {p.shape !== 'slot' && !menu && itemsMenu ? itemsMenu : null}

                        {p.shape !== 'slot' && !menu && !itemsMenu && (
                            <section className="mt-8 border-t border-slate-200 pt-8">
                                <h2 className="text-xl md:text-2xl font-bold text-slate-900">What you get</h2>
                                <ul className="mt-4 divide-y divide-slate-100">
                                    {p.items.map((it) => {
                                        const dur = durationLabel(it.duration_minutes);
                                        return (
                                            <li key={it.id} className="flex gap-4 py-4 first:pt-0">
                                                {it.image ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={it.image} alt="" loading="lazy" className="h-16 w-16 flex-none rounded-xl object-cover" />
                                                ) : (
                                                    <span className="flex h-16 w-16 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                                                        <Utensils className="h-6 w-6" aria-hidden />
                                                    </span>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-baseline justify-between gap-3">
                                                        <span className="font-semibold text-slate-900">{it.name}</span>
                                                        <span className="whitespace-nowrap font-semibold text-slate-900">{itemPriceLabel(it.price, it.unit)}</span>
                                                    </div>
                                                    {itemGuestRange(it, p.maxGuests) ? (
                                                        <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-slate-500">
                                                            <Users className="h-3.5 w-3.5 flex-none" aria-hidden />{itemGuestRange(it, p.maxGuests)}
                                                        </p>
                                                    ) : null}
                                                    {itemExtrasSubline(it, p.minAge) ? (
                                                        <p className="mt-0.5 text-xs text-slate-500">{itemExtrasSubline(it, p.minAge)}</p>
                                                    ) : null}
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

                        {(() => {
                            // Only the fields the provider actually filled in — a
                            // whitespace-only value counts as empty — and the whole
                            // section drops when none are set, so a chef (no activity
                            // level, nothing to bring) shows no "Things to know" at all.
                            const activity = (p.activityLevel || '').trim();
                            const bring = (p.whatToBring || '').trim();
                            if (p.minAge == null && !activity && !bring) return null;
                            return (
                                <section className="mt-8 border-t border-slate-200 pt-8">
                                    <h2 className="text-xl md:text-2xl font-bold text-slate-900">Things to know</h2>
                                    <div className="mt-4 space-y-4">
                                        {p.minAge != null ? (
                                            <div className="flex items-start gap-3">
                                                <ShieldAlert className="mt-0.5 h-5 w-5 flex-none text-slate-500" aria-hidden />
                                                <div><div className="font-semibold text-slate-900">Minimum age</div><p className="text-sm text-slate-600">{p.minAge} and over</p></div>
                                            </div>
                                        ) : null}
                                        {activity ? (
                                            <div className="flex items-start gap-3">
                                                <Activity className="mt-0.5 h-5 w-5 flex-none text-slate-500" aria-hidden />
                                                <div><div className="font-semibold text-slate-900">Activity level</div><p className="text-sm capitalize text-slate-600">{activity}</p></div>
                                            </div>
                                        ) : null}
                                        {bring ? (
                                            <div className="flex items-start gap-3">
                                                <Backpack className="mt-0.5 h-5 w-5 flex-none text-slate-500" aria-hidden />
                                                <div><div className="font-semibold text-slate-900">What to bring</div><p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{bring}</p></div>
                                            </div>
                                        ) : null}
                                    </div>
                                </section>
                            );
                        })()}

                        {(() => { const steps = experienceSteps(p.shape, p.fulfilment, p.itinerary); return (p.what_happens || steps.length > 0) ? (
                            <section className="mt-8 border-t border-slate-200 pt-8">
                                <h2 className="text-xl md:text-2xl font-bold text-slate-900">What happens</h2>
                                {p.what_happens ? (
                                    <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{p.what_happens}</p>
                                ) : null}
                                {steps.length > 0 ? (
                                    <ol className="mt-5 space-y-5">
                                        {steps.map((step, i) => {
                                            const Icon = phaseIcon(step.icon);
                                            return (
                                                <li key={i} className="flex gap-3.5">
                                                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                                                        <Icon className="h-4 w-4" aria-hidden />
                                                    </span>
                                                    <div className="min-w-0">
                                                        <div className="font-semibold text-slate-900">{step.title}</div>
                                                        <p className="mt-0.5 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{step.detail}</p>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ol>
                                ) : null}
                            </section>
                        ) : null; })()}

                        {/* What's included — the provider's ticked amenities, as a
                            scannable list (no prose). Shown for every shape when they
                            ticked anything. */}
                        {p.amenities.length > 0 && (
                            <section className="mt-8 border-t border-slate-200 pt-8">
                                <h2 className="text-xl md:text-2xl font-bold text-slate-900">What’s included</h2>
                                <ul className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                                    {p.amenities.map((k) => {
                                        const label = experienceAmenityLabel(k);
                                        return label ? (
                                            <li key={k} className="flex items-center gap-3">
                                                <Check className="h-5 w-5 flex-none text-emerald-700" aria-hidden />
                                                <span className="text-[15px] text-slate-700">{label}</span>
                                            </li>
                                        ) : null;
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

                        {/* Roughly-here map for a fixed venue — kept in the left
                            column so the booking card sits beside it and finishes
                            level with the bottom of the map: that is where the
                            sticky card releases. A jittered pin, never the door;
                            a traveller has no one place, so no map. */}
                        {(!comesToYou && p.mapLat != null && p.mapLng != null) ? (
                            <PropertyMap latitude={p.mapLat} longitude={p.mapLng} area={tag || undefined} />
                        ) : null}
                    </div>

                    <div className="lg:sticky lg:top-24 lg:self-start">{panel}</div>
                </div>

                {/* Full-width below the two-column region: reviews first (capped
                    at four with a Show-all control, the same as the cottage), then
                    the cancellation policy. The card above has already released
                    level with the bottom of the map. */}
                <div className="pb-12">
                    {/* Reviews — the cottage listing's section, in the same
                        craft and language so the two read as one product. Shown
                        always: an honest empty state reads as new, a missing
                        section reads as unfinished. The score is withheld until
                        there are enough to mean one (lib/reviews). */}
                    {reviews && (
                        reviews.count === 0 ? (
                            <section className="mt-8 border-t border-slate-200 pt-8">
                                <h2 className="text-xl md:text-2xl font-bold text-slate-900">Reviews</h2>
                                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-6">
                                    <div className="font-semibold text-slate-900">No reviews yet</div>
                                    <p className="mt-1 text-sm text-slate-600">
                                        This experience is newly listed, so nobody has been and reviewed it
                                        through Galloway Getaways yet. Reviews appear here once guests have
                                        been — and being one of the first to book means yours will be the
                                        one others read.
                                    </p>
                                </div>
                            </section>
                        ) : (
                            <section className="mt-8 border-t border-slate-200 pt-8">
                                <h2 className="flex items-center gap-2 text-xl md:text-2xl font-bold text-slate-900">
                                    {reviews.avg !== null ? (
                                        <>
                                            <ReviewStars value={Math.round(reviews.avg)} size={18} />
                                            {reviews.avg.toFixed(1)} · {reviews.count} review{reviews.count > 1 ? 's' : ''}
                                        </>
                                    ) : (
                                        <>{reviews.count} review{reviews.count > 1 ? 's' : ''}</>
                                    )}
                                </h2>
                                {reviews.avg === null && (
                                    <p className="-mt-1 mb-5 text-sm text-slate-600">
                                        An overall score appears once this experience has {MIN_PUBLIC_REVIEWS} reviews.
                                    </p>
                                )}
                                <ShowAllReviews initial={4} className="mt-5 space-y-5">
                                    {reviews.items.map((r) => (
                                        <div key={r.id} className="border-b border-slate-100 pb-5 last:border-0 last:pb-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold text-slate-900">{capitializeFirst(r.firstName || 'Guest')}</span>
                                                <ReviewStars value={r.rating} size={14} />
                                                {r.itemName ? (
                                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{r.itemName}</span>
                                                ) : null}
                                            </div>
                                            <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{r.comment}</p>
                                            <ProviderReplyBox
                                                reviewId={r.id}
                                                existingReply={r.reply}
                                                providerFirstName={capitializeFirst(reviews.providerFirstName)}
                                                canReply={reviews.canReply}
                                            />
                                        </div>
                                    ))}
                                </ShowAllReviews>
                            </section>
                        )
                    )}

                    <section className="mt-8 border-t border-slate-200 pt-8">
                        <h2 className="text-xl md:text-2xl font-bold text-slate-900">Cancellation</h2>
                        <p className="mt-1 text-sm font-semibold text-slate-700">{cancelPolicy.label}</p>
                        <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
                            {p.noRefund
                                ? 'This experience is non-refundable once booked — please be sure of your plans before you pay.'
                                : cancellationSentence(p.shape, p.cancellation_window_hours, who)}
                        </p>
                        {(comesToYou || tag) ? (
                            <p className="mt-3 flex items-start gap-1.5 text-sm text-slate-500">
                                <MapPin className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
                                <span>
                                    {comesToYou
                                        ? (travelCoverage
                                            ? travelCoverage + ' — they come to where you’re staying, so there’s nothing for you to travel to.'
                                            : 'They come to where you’re staying — nothing for you to travel to.')
                                        : 'The exact address is shared once your booking is confirmed.'}
                                </span>
                            </p>
                        ) : null}
                    </section>
                </div>
            </div>
        </div>
    );
}
