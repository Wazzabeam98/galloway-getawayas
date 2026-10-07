import Link from 'next/link';
import Image from 'next/image';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen, businessSignupsOpen } from '@/lib/serviceOrders';
import { loadPublicMarketplace, type MpProvider } from '@/lib/experiencesData';
import { locationTag, cardLocationLine, priceParts } from '@/components/marketplace/present';

// Experiences on the home page, so a visitor sees everything on offer without
// having to know the /experiences URL. Two states, and the page places each
// where it belongs: with live providers (GUEST_EXPERIENCES_OPEN on, at least one
// with a real photo) the shelf of cards sits directly under Our Properties;
// while the shelf is still empty the "coming soon" panel drops down between the
// towns row and the map instead, so an empty section never leads the page. Never
// an empty shelf and never nothing — the coming-soon panel says what is coming
// and asks local businesses to be among the first listed. The ask goes where the
// business sign-up switch says: the real guest-experience start once sign-ups
// open, register-interest until then.
//
// Cards carry no rating, like a new property's — no stars until there are
// reviews to mean one.
const MAX_ON_HOME = 8;

// The live providers to show on the home shelf (an empty array means the shelf
// is still coming soon). Exported so app/page.tsx can place each state where it
// belongs, deciding from the same read it renders — without loading the (heavy)
// marketplace twice.
export async function liveHomeProviders(): Promise<MpProvider[]> {
    if (!guestExperiencesOpen()) return [];
    const mp = await loadPublicMarketplace(adminClient(), true);
    if (!mp.open) return [];
    // Only ones with a real photo — a card on a bare gradient block reads as
    // unfinished, so it is not shown at all.
    return mp.providers.filter((p) => !!p.hero).slice(0, MAX_ON_HOME);
}

// The "Experiences" section, placed by the page directly under Our Properties
// and built the same way: the same heading treatment and the same card — photo,
// name, town, price — so the second thing to book reads as part of one shelf.
// Renders nothing when no experience is live (the page then shows the
// coming-soon panel further down instead).
export default function HomeExperiences({ providers }: { providers: MpProvider[] }) {
    if (providers.length === 0) return null;

    return (
        <section className="mt-16" aria-labelledby="home-experiences">
            <div className="mb-10 border-b border-stone-200 pb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 id="home-experiences" className="text-2xl md:text-3xl font-bold text-stone-900">Experiences</h2>
                    <p className="text-stone-600 text-sm md:text-base mt-1">
                        Local chefs, saunas, classes and guides across Dumfries &amp; Galloway
                    </p>
                </div>
                <Link href="/experiences/browse" className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 underline underline-offset-4">
                    See all experiences
                </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10">
                {providers.map((p) => <ExperienceCard key={p.id} p={p} />)}
            </div>
        </section>
    );
}

// One experience in the property card's shape (components/ListingCard): the
// photo in the same h-64 rounded frame, the name bold on one line, the town
// beneath, the price last — "From £20 / guest" where ListingCard says "£140 night".
function ExperienceCard({ p }: { p: MpProvider }) {
    const town = locationTag(p) || cardLocationLine(p) || 'Dumfries & Galloway';
    const cheapest = [...p.items].sort((a, b) => a.price - b.price)[0];
    const { money, per } = priceParts(p.priceFrom, cheapest ? cheapest.unit : 'flat');
    return (
        <Link href={`/experiences/browse/${p.id}`} className="group flex flex-col space-y-2">
            <div className="w-full h-64 rounded-2xl overflow-hidden bg-stone-200 relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.hero!} alt={`${p.business_name}, an experience in ${town}`} loading="lazy"
                    className="h-full w-full object-cover group-hover:scale-105 transition duration-300" />
            </div>
            <h3 className="font-bold text-stone-900 text-base truncate">{p.business_name}</h3>
            <p className="text-sm text-stone-500 truncate">{town}</p>
            <p className="text-sm font-semibold text-stone-900">
                {p.items.length > 1 ? 'From ' : ''}{money}{per && <span className="font-normal text-stone-500"> {per}</span>}
            </p>
        </Link>
    );
}

// The pair of licensed photographs the provider sign-up already uses on its
// empty Photos screen (see public/images/experience-photos/README.md), so the
// panel looks like the product it is announcing rather than a placeholder.
export function ExperiencesComingSoon() {
    const href = businessSignupsOpen()
        ? '/services/join?trade=guest'
        : '/register-interest?type=guest_experience';

    return (
        <section className="mt-16 pt-10 border-t border-stone-200">
            <div className="grid items-center gap-10 rounded-2xl bg-white border border-stone-200 p-6 sm:p-10 md:grid-cols-[1fr_auto]">
                <div className="max-w-xl">
                    <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700">
                        Coming soon
                    </span>
                    <h2 className="mt-4 text-2xl md:text-3xl font-bold text-stone-900">
                        Experiences
                    </h2>
                    <p className="mt-3 text-stone-600 leading-relaxed">
                        A private chef on your first night, a wood-fired sauna by the shore, fresh
                        bread on the doorstep, a guided day on the hills. Soon you’ll be able to
                        book them alongside your stay, from local businesses across Dumfries &amp;
                        Galloway.
                    </p>

                    <div className="mt-8 border-t border-stone-200 pt-6">
                        <p className="font-semibold text-stone-900">
                            Run an experience in the region?
                        </p>
                        <p className="mt-1 text-sm text-stone-600">
                            We’re choosing the first businesses to list now. You set your prices
                            and your times, and there’s no monthly fee.
                        </p>
                        <Link
                            href={href}
                            className="mt-4 inline-flex items-center rounded-lg bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
                        >
                            Offer an experience
                        </Link>
                    </div>
                </div>

                <div className="relative mx-auto hidden h-[300px] w-[300px] sm:block" aria-hidden="true">
                    <div className="absolute left-0 top-6 h-[240px] w-[192px] -rotate-6 overflow-hidden rounded-2xl shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                        <Image src="/images/experience-photos/sauna.jpg" alt="" fill sizes="192px" className="object-cover" />
                    </div>
                    <div className="absolute right-0 top-0 h-[240px] w-[192px] rotate-3 overflow-hidden rounded-2xl shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                        <Image src="/images/experience-photos/loaf.jpg" alt="" fill sizes="192px" className="object-cover" />
                    </div>
                </div>
            </div>
        </section>
    );
}
