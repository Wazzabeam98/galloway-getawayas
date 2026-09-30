import { redirect } from 'next/navigation';
import Link from 'next/link';
import { adminClient } from '@/lib/supabaseAdmin';
import { getImageUrl } from '@/lib/utils';
import {
    tradeLabel,
    calloutLine,
    capabilityFor,
    schemeLabel,
    registrationVerified,
    registrationExpired,
    audienceForTrade,
} from '@/lib/serviceProviders';
import { visibleInDirectory } from '@/lib/serviceSubscription';
import PhotoGallery from '@/components/PhotoGallery';
import HostCredentials from '@/components/marketplace/HostCredentials';
import { MapPin, ShieldCheck, BadgeCheck, Wrench, Clock, CalendarClock, ArrowRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

// The PUBLIC profile of ONE tradesperson — the trade side's answer to a guest
// experience provider's listing page (components/marketplace/ExperienceListingBody),
// laid out the same way and reusing the same pieces (PhotoGallery, HostCredentials,
// PropertyMap). A trade is OFF-PLATFORM, so where an experience has a booking /
// checkout panel this has an enquiry CTA — no dates, no card, no money. The host
// enquires, the trade quotes, the host pays them directly.
//
// Read under the service role and render only PUBLIC fields (never contact email
// or phone — those are released to the host only when the trade accepts an
// enquiry). Visibility mirrors the directory: approved AND not delisted.

export async function generateMetadata(
    { params }: { params: { providerId: string } }
): Promise<import('next').Metadata> {
    const admin = adminClient();
    const { data } = await admin
        .from('service_providers').select('business_name').eq('id', params.providerId).maybeSingle();
    return { title: (data && data.business_name) || 'Trade', robots: { index: false, follow: false } };
}

export default async function TradeProfilePage({ params }: { params: { trade: string; providerId: string } }) {
    const admin = adminClient();

    const { data: provider } = await admin
        .from('service_providers')
        .select('id, business_name, trade, audience, status, subscription_status, description, headshot, photos, guest_details, registration_number, callout_fee, callout_waived, hourly_rate, flat_fee, provides_quote, does_emergency, does_scheduled')
        .eq('id', params.providerId)
        .maybeSingle();

    // Not found, not a trade, the wrong trade's URL, or not publicly visible
    // (pre-approval, or delisted for non-payment) → back to the directory.
    if (!provider
        || audienceForTrade(provider.trade) === 'guest'
        || provider.trade !== params.trade
        || !visibleInDirectory(provider)) {
        redirect('/services/' + encodeURIComponent(params.trade));
    }

    const [{ data: areas }, { data: extraRows }, { data: skillLinks }, { data: regs }] = await Promise.all([
        admin.from('service_areas').select('label, centre_lat, centre_lng').eq('provider_id', provider.id).order('created_at', { ascending: true }),
        admin.from('service_provider_extras').select('extra_key, offered').eq('provider_id', provider.id),
        admin.from('service_provider_skills').select('skill_id').eq('provider_id', provider.id),
        admin.from('service_provider_registrations').select('scheme, number, verified_at, verified_number, expires_at').eq('provider_id', provider.id),
    ]);

    // Services = the free-text skills they added ("the jobs you take on") plus the
    // capability ticks, both shown as plain chips.
    const skillIds = (skillLinks || []).map((r: any) => r.skill_id);
    const { data: skillRows } = skillIds.length
        ? await admin.from('service_skills').select('id, label').in('id', skillIds)
        : { data: [] as any[] };
    const capLabels: Record<string, string> = {};
    for (const e of capabilityFor(provider.trade)) capLabels[e.key] = e.label;
    const offeredCaps = (extraRows || []).filter((e: any) => e.offered && capLabels[e.extra_key]).map((e: any) => capLabels[e.extra_key]);
    const services = Array.from(new Set([...(skillRows || []).map((r: any) => r.label), ...offeredCaps])).filter(Boolean);

    const gd = (provider.guest_details && typeof provider.guest_details === 'object') ? provider.guest_details as any : {};
    const years = String(gd.years_experience || '').trim();
    const title = String(gd.professional_title || '').trim();
    const coverage = (areas || []).map((a: any) => a.label).filter(Boolean).join(' · ');

    const priceLine = provider.provides_quote
        ? 'Priced per job — quoted after a look'
        : [
            provider.hourly_rate ? '£' + provider.hourly_rate + ' an hour' : '',
            provider.flat_fee ? '£' + provider.flat_fee + ' a job' : '',
        ].filter(Boolean).join(' · ');
    const callout = calloutLine(provider.callout_fee, provider.callout_waived);
    const availability = [
        provider.does_emergency ? 'Emergency call-outs' : '',
        provider.does_scheduled ? 'Scheduled work' : '',
    ].filter(Boolean);
    const verifiedRegs = (regs || []).filter((r: any) => registrationVerified(r) && !registrationExpired(r));

    const facts: { icon: React.ReactNode; label: string; value: string }[] = [];
    if (coverage) facts.push({ icon: <MapPin className="h-5 w-5 text-slate-500" aria-hidden />, label: 'Covers', value: coverage });
    if (priceLine || callout) facts.push({ icon: <Wrench className="h-5 w-5 text-slate-500" aria-hidden />, label: 'Charges', value: [priceLine, callout].filter(Boolean).join(' · ') });
    if (availability.length) facts.push({ icon: <Clock className="h-5 w-5 text-slate-500" aria-hidden />, label: 'Availability', value: availability.join(' · ') });

    const backHref = '/services/' + encodeURIComponent(provider.trade);
    const photos: string[] = Array.isArray(provider.photos) ? provider.photos : [];

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-5 sm:pt-6 pb-24">
                <Link href={backHref} className="text-sm font-medium text-slate-500 hover:text-slate-800">
                    ← All {tradeLabel(provider.trade).toLowerCase()}s
                </Link>

                {photos.length ? (
                    <PhotoGallery images={photos} title={provider.business_name} area={coverage || undefined} />
                ) : (
                    <div className="my-4 flex h-[280px] w-full items-center justify-center rounded-2xl bg-slate-100 text-5xl font-semibold text-slate-300 md:h-[420px]">
                        {(provider.business_name || '?').slice(0, 1)}
                    </div>
                )}

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 lg:gap-10 mt-2">
                    <div className="lg:col-span-2 min-w-0">
                        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-emerald-700">{tradeLabel(provider.trade)}</p>
                        <h1 className="mt-1.5 text-2xl md:text-3xl font-bold text-slate-900">{provider.business_name}</h1>
                        {title ? <p className="mt-1.5 text-slate-500">{title}</p> : null}

                        {provider.description ? (
                            <p className="mt-5 whitespace-pre-line text-base md:text-lg leading-relaxed text-slate-700">{provider.description}</p>
                        ) : null}

                        {facts.length > 0 && (
                            <dl className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5 border-t border-slate-200 pt-7">
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

                        {/* About the trade — the same block shape as an experience host:
                            photo, name, years, then credentials as quiet details. */}
                        <section className="mt-8 border-t border-slate-200 pt-6">
                            <div className="flex items-center gap-3">
                                {provider.headshot ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={getImageUrl(provider.headshot)} alt="" className="h-12 w-12 flex-none rounded-full object-cover ring-1 ring-slate-200" />
                                ) : (
                                    <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-slate-100 text-base font-semibold text-slate-500">
                                        {(provider.business_name || '?').slice(0, 1)}
                                    </span>
                                )}
                                <div className="min-w-0">
                                    <h2 className="text-lg md:text-xl font-bold text-slate-900">About {provider.business_name}</h2>
                                    {years ? <p className="text-sm text-slate-500">{years} {Number(years) === 1 ? 'year' : 'years'} at it</p> : null}
                                </div>
                                <span className="ml-auto flex-none inline-flex items-center gap-1 self-start rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/15">
                                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified business
                                </span>
                            </div>
                            <HostCredentials qualifications={gd.qualifications} recognition={gd.recognition} className="mt-5" />
                        </section>

                        {services.length > 0 && (
                            <section className="mt-8 border-t border-slate-200 pt-8">
                                <h2 className="text-xl md:text-2xl font-bold text-slate-900">What {provider.business_name} does</h2>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {services.map((s) => (
                                        <span key={s} className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800">{s}</span>
                                    ))}
                                </div>
                            </section>
                        )}

                        {(provider.registration_number || verifiedRegs.length > 0) && (
                            <section className="mt-8 border-t border-slate-200 pt-8">
                                <h2 className="text-xl md:text-2xl font-bold text-slate-900">Registration</h2>
                                <div className="mt-4 space-y-2">
                                    {verifiedRegs.map((r: any) => (
                                        <p key={r.scheme} className="flex items-center gap-1.5 text-sm text-emerald-800">
                                            <ShieldCheck className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                                            {schemeLabel(r.scheme)} {r.number} — checked by us
                                        </p>
                                    ))}
                                    {provider.registration_number && (
                                        <p className="text-sm text-slate-600">Registration no. {provider.registration_number}</p>
                                    )}
                                </div>
                            </section>
                        )}

                        {/* No map here: a trade covers an AREA (a radius), not a
                            fixed venue, and PropertyMap's "exact address shared once
                            your booking is confirmed" copy is a guest-booking line
                            that doesn't fit an off-platform trade. The coverage is
                            stated as a fact above. (A map belongs on the host's
                            enquiry pane, against their own cottage, not here.) */}
                    </div>

                    {/* The enquiry CTA — the trade side's answer to the booking panel.
                        No dates, no card: it opens the enquiry on the directory page,
                        where the host's cottage and details are already to hand. */}
                    <div className="lg:col-span-1">
                        <div className="lg:sticky lg:top-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                            <p className="text-sm text-slate-600">
                                Send {provider.business_name} the job and they&rsquo;ll come back to you. You agree the
                                price and pay them directly — nothing goes through Galloway Getaways.
                            </p>
                            <Link
                                href={backHref + '?ask=' + provider.id}
                                className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800"
                            >
                                Ask {provider.business_name} <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
                            </Link>
                            <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
                                <CalendarClock className="h-3.5 w-3.5" aria-hidden /> They reply by email — usually within a day.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
