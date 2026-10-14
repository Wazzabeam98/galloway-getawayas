import Link from 'next/link';
import { shapeCue } from '@/lib/serviceSlots';
import { dietaryOptionLabel, accessibilityLabel, parkingLabel, experienceCancellationOption, experienceAmenityLabel } from '@/lib/serviceProviders';
import {
    itemPriceLabel, itemPriceDisplay, itemExtrasSubline, itemGuestRange, cancellationSentence, whereLine, locationTag, travelCoverageLine,
    durationLabel, durationSummary, yearsLabel, capacityLabel, fromPriceLabel,
} from '@/components/marketplace/present';
import EnquireButton from '@/components/marketplace/EnquireButton';
import ListingStickyHeader from '@/components/ListingStickyHeader';
import MeetYourHost from '@/components/MeetYourHost';
import AboutThisPlace from '@/components/AboutThisPlace';
import ReportListing from '@/components/ReportListing';
import { unitMultiplies } from '@/lib/serviceOrders';
import { locationFromDirection } from '@/lib/orderLocation';
import { MapPin, Clock, Users, User, BadgeCheck, Activity, Backpack, ShieldAlert, ShieldCheck, Accessibility, Car, Check, Utensils } from 'lucide-react';
import { experienceSteps } from '@/lib/experienceSteps';
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

// The listing body, in the cottage-page craft (photo mosaic, facts icon-list,
// section rhythm). Shared by the against-a-stay page and the public/standalone
// page so both read as one listing; the caller passes the right-hand `panel` (the
// stay booking panel, the standalone one, or the honest "book with a stay"
// notice). A plain server component. Rules: first name only, no ratings/counts,
// no address before payment.
export default function ExperienceListingBody({
    p, backHref, backLabel, panel, reviews, menu, itemsMenu, sticky, responsiveness, reportable,
}: {
    p: MpProvider;
    backHref: string;
    backLabel: string;
    panel: React.ReactNode;
    // Show "Report this listing" at the foot — the cottage's ReportListing, reused.
    // Passed by the public experience listing; the order page leaves it out.
    reportable?: boolean;
    // The provider's response rate / typical reply time, worked out server-side
    // from their orders and message threads (lib/hostResponsiveness →
    // providerResponsiveness). Passed ONLY by the public listing page; when it's
    // present the full "Meet your host" card (the cottage's MeetYourHost) is shown
    // in place of the compact host block. Other pages (against a stay, the order
    // page) leave it out and keep the compact block.
    responsiveness?: { responseRatePercent: number; typicalLabel: string };
    // The desktop section bar (Airbnb's, the cottage's ListingStickyHeader) +
    // the phone's behaviour below the gallery. Passed only by the public bookable
    // listing — not the paused page (no booking) nor the against-a-stay variant.
    // When set, the body renders the fixed top bar and the anchors/sentinels it
    // scrolls to; the main nav un-sticks on this route via ChromeGate.
    sticky?: boolean;
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

    // The intro under the title. A new provider's description is DERIVED from
    // their "What happens" — the optional note (what_happens) when they wrote one,
    // otherwise the three-step flow joined (Liam, 9 Oct 2026) — so showing the
    // intro as well would print the same words twice. It is suppressed when the
    // description matches EITHER the note OR the joined flow; an older listing with
    // a genuinely separate description still shows it.
    const flowText = Array.isArray(p.itinerary)
        ? p.itinerary.map((r: { detail?: string | null }) => String(r?.detail || '').trim()).filter(Boolean).join('. ')
        : '';
    const descTrimmed = (p.description || '').trim();
    const intro = descTrimmed
        && descTrimmed !== String(p.what_happens || '').trim()
        && descTrimmed !== flowText
        ? p.description
        : null;

    const years = yearsLabel(p.yearsExperience);
    const hasAbout = Boolean(years || p.qualifications || p.recognition);
    // The host's first name for the MeetYourHost card; "your host" when they show
    // no name (never a bare surname — byline is already first-name-only).
    const hostFirstName = p.byline ? capitializeFirst(p.byline) : 'your host';
    // The provider's trade credentials MeetYourHost has no slot for (their years in
    // the trade, training, recognition) — kept beneath the card so they aren't lost.
    const hasCredentials = Boolean(years || p.qualifications || p.recognition);

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

    // The desktop section bar (reused from the cottage: ListingStickyHeader). The
    // sections it can jump to depend on what this listing actually renders, so the
    // links are built here, from the same conditions used below. A fixed venue has
    // a map ("Location"); a traveller doesn't. The price is the one the panel
    // shows, capitalised for the bar; the idle button word is "See the menu" for a
    // made-to-order shop, "Check availability" otherwise.
    const hasMap = !comesToYou && p.mapLat != null && p.mapLng != null;
    const navLinks: { id: string; label: string }[] = [];
    if (p.galleryKeys.length) navLinks.push({ id: 'photos', label: 'Photos' });
    if (p.amenities.length > 0) navLinks.push({ id: 'included', label: 'What’s included' });
    if (reviews) navLinks.push({ id: 'reviews', label: 'Reviews' });
    if (hasMap) navLinks.push({ id: 'location', label: 'Location' });
    const rawPrice = fromPriceLabel(p);
    const stickyPrice = rawPrice ? rawPrice.charAt(0).toUpperCase() + rawPrice.slice(1) : '';
    const stickyIdle = p.shape === 'made_to_order' ? 'See the menu' : 'Check availability';

    return (
        <div className="min-h-screen bg-slate-50">
            {sticky && (
                <ListingStickyHeader
                    links={navLinks}
                    priceLabel={stickyPrice}
                    reserveLabel={stickyIdle}
                    idleLabel={stickyIdle}
                    showScore={!!reviews && reviews.avg !== null}
                    ratingAvg={reviews?.avg ?? 0}
                    ratingCount={reviews?.count ?? 0}
                />
            )}
            <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-5 sm:pt-6">
                <Link href={backHref} className="text-sm font-medium text-slate-500 hover:text-slate-800">
                    ← {backLabel}
                </Link>

                <div id="photos" className="scroll-mt-24">
                    {p.galleryKeys.length ? (
                        <PhotoGallery images={p.galleryKeys} title={p.business_name} area={tag || undefined} kind={(p.category || 'experience').toLowerCase()} />
                    ) : (
                        <div className="my-4 flex h-[300px] w-full items-center justify-center rounded-2xl bg-slate-100 text-5xl font-semibold text-slate-300 md:h-[460px]">
                            {who.slice(0, 1)}
                        </div>
                    )}
                </div>

                {/* The bar appears once the photos have scrolled off the top. */}
                {sticky && <div id="sticky-sentinel" aria-hidden />}

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 lg:gap-10 mt-2">
                    <div className="lg:col-span-2 min-w-0">
                        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-emerald-700">{p.category}</p>
                        <h1 className="mt-1.5 text-2xl md:text-3xl font-bold text-slate-900">{p.business_name}</h1>
                        <span className="mt-2 inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                            {shapeCue(p.shape)}
                        </span>

                        {/* The lead description (deduped against "What happens" so the
                            same paragraph never prints twice), with the cottage's
                            clamp + Show-more dialog (AboutThisPlace): clamped until
                            opened, the whole thing in a dialog. No heading — the
                            listing title is right above it. */}
                        {intro ? (
                            <AboutThisPlace text={intro} title={null} className="mt-5" />
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

                        {/* The compact host block — kept for the pages that don't
                            pass responsiveness (against a stay, the order page). The
                            public listing shows the full "Meet your host" card
                            (MeetYourHost) full-width at the foot instead. */}
                        {!responsiveness && hasAbout && (
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

                                {/* The payment-safety line the cottage host card
                                    carries (and Airbnb shows on every listing) —
                                    keep money and messages on the platform. */}
                                <p className="mt-5 flex items-start gap-2 text-sm text-slate-500">
                                    <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-slate-400" aria-hidden />
                                    <span>To help protect your payment, always pay and message through Galloway Getaways.</span>
                                </p>
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
                                                    <img src={it.image} alt={it.name} loading="lazy" className="h-24 w-32 flex-none rounded-xl object-cover" />
                                                ) : (
                                                    <span className="flex h-24 w-32 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                                                        <Utensils className="h-6 w-6" aria-hidden />
                                                    </span>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-baseline justify-between gap-3">
                                                        <span className="font-semibold text-slate-900">{it.name}</span>
                                                        <span className="whitespace-nowrap font-semibold text-slate-900">{itemPriceDisplay(it)}</span>
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
                            // A made-to-order listing is a shop, not an experience you
                            // attend, so it never carries this section.
                            if (p.shape === 'made_to_order') return null;
                            const activity = (p.activityLevel || '').trim();
                            const bring = (p.whatToBring || '').trim();
                            if (p.minAge == null && !activity && !bring) return null;
                            return (
                                <section className="mt-8 border-t border-slate-200 pt-8">
                                    <h2 className="text-xl md:text-2xl font-bold text-slate-900">Things to know</h2>
                                    {/* Columns, the cottage's "Things to know" rhythm
                                        (and Airbnb's experience page): one column on a
                                        phone, up to three on desktop. */}
                                    <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
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
                                {steps.length > 0 ? (
                                    // Numbered steps, Airbnb-style — a filled numeral, the step's
                                    // label in bold, then the detail. `experienceSteps` has already
                                    // dropped any phase the provider left blank, so the numbers run
                                    // 1, 2, 3 over the steps that are actually there.
                                    <ol className="mt-5 space-y-5">
                                        {steps.map((step, i) => (
                                            <li key={i} className="flex gap-3.5">
                                                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-emerald-50 text-sm font-bold tabular-nums text-emerald-700 ring-1 ring-emerald-100">
                                                    {i + 1}
                                                </span>
                                                <div className="min-w-0">
                                                    <div className="font-semibold text-slate-900">{step.title}</div>
                                                    <p className="mt-0.5 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{step.detail}</p>
                                                </div>
                                            </li>
                                        ))}
                                    </ol>
                                ) : null}
                                {/* The optional note sits BELOW the numbered steps (Liam, 9 Oct
                                    2026) — anything that isn't a step (parking, access). More
                                    air above it when steps precede it; directly under the
                                    heading when there are none. */}
                                {p.what_happens ? (
                                    <p className={(steps.length > 0 ? 'mt-6' : 'mt-3') + ' whitespace-pre-line text-[15px] leading-relaxed text-slate-700'}>{p.what_happens}</p>
                                ) : null}
                            </section>
                        ) : null; })()}

                        {/* What's included — the provider's ticked amenities, as a
                            scannable list (no prose). Shown for every shape when they
                            ticked anything. */}
                        {p.amenities.length > 0 && (
                            <section id="included" className="mt-8 border-t border-slate-200 pt-8 scroll-mt-24">
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
                        {hasMap ? (
                            <div id="location" className="scroll-mt-24">
                                <PropertyMap latitude={p.mapLat!} longitude={p.mapLng!} area={tag || undefined} precise={p.mapPrecise} />
                            </div>
                        ) : null}
                    </div>

                    <div id="book" className="lg:sticky lg:top-24 lg:self-start scroll-mt-24">{panel}</div>
                </div>

                {/* Once the booking card passes the bar line, the bar reveals its
                    own price + button (ListingStickyHeader watches this). */}
                {sticky && <div id="bookcard-sentinel" aria-hidden />}

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
                            <section id="reviews" className="mt-8 border-t border-slate-200 pt-8 scroll-mt-24">
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
                            <section id="reviews" className="mt-8 border-t border-slate-200 pt-8 scroll-mt-24">
                                {/* Just the overall star rating out of 5 and the number
                                    of reviews, then the cards — no 5-to-1 breakdown bars
                                    (that stays on the cottage). Below the public
                                    threshold the words show with no score. */}
                                {reviews.avg !== null ? (
                                    <h2 className="flex items-center gap-2 text-xl md:text-2xl font-bold text-slate-900">
                                        <ReviewStars value={Math.round(reviews.avg)} size={18} />
                                        {reviews.avg.toFixed(1)} · {reviews.count} review{reviews.count > 1 ? 's' : ''}
                                    </h2>
                                ) : (
                                    <>
                                        <h2 className="text-xl md:text-2xl font-bold text-slate-900">
                                            {reviews.count} review{reviews.count > 1 ? 's' : ''}
                                        </h2>
                                        <p className="-mt-1 mb-5 text-sm text-slate-600">
                                            An overall score appears once this experience has {MIN_PUBLIC_REVIEWS} reviews.
                                        </p>
                                    </>
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

                    {/* "Meet your host", the cottage's card (MeetYourHost) — full
                        width at the foot so it's landscape on desktop, stacked on a
                        phone. Shown on the public listing (responsiveness passed);
                        co-hosts left out (a provider has none). The trade credentials
                        MeetYourHost has no slot for sit just beneath it. */}
                    {responsiveness && (
                        <>
                            <MeetYourHost
                                firstName={hostFirstName}
                                avatarUrl={p.hostAvatar}
                                verified={p.verified}
                                bio={p.hostBio}
                                sinceYear={p.hostSinceYear}
                                monthsHosting={p.hostMonthsHosting}
                                ratingAvg={reviews?.avg ?? 0}
                                ratingCount={reviews?.count ?? 0}
                                showScore={!!reviews && reviews.avg !== null}
                                coHosts={[]}
                                responseRatePercent={responsiveness.responseRatePercent}
                                typicalLabel={responsiveness.typicalLabel}
                            />
                            {hasCredentials && (
                                <div className="mt-6">
                                    {years ? <p className="text-sm font-medium text-slate-700">{years}</p> : null}
                                    <HostCredentials qualifications={p.qualifications} recognition={p.recognition} className="mt-3" />
                                </div>
                            )}
                            {/* A general way to ask the provider something before
                                booking — dates, group size, anything else. */}
                            <div className="mt-6">
                                <EnquireButton providerId={p.id} providerName={p.business_name} />
                            </div>
                        </>
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

                    {/* Report this listing — the cottage's component, same form and
                        admin queue, at the foot of the page. */}
                    {reportable && (
                        <div className="mt-12 pt-8 border-t border-slate-200 flex justify-center">
                            <ReportListing targetType="experience" targetId={p.id} title={p.business_name} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
