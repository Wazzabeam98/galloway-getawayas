'use client';

import Link from 'next/link';
import { MapPin, ShieldCheck, MessageSquare, ArrowRight } from 'lucide-react';
import { getImageUrl } from '@/lib/utils';
import {
    tradeLabel,
    calloutLine,
    initialsFor,
    schemeLabel,
    registrationVerified,
    registrationExpired,
} from '@/lib/serviceProviders';

// One tradesperson, as a card in the same family as the property ListingCard:
// a photo inset in a rounded box, a tight neutral type scale, small muted
// icons, and — the part that makes it — an action row of icon buttons at the
// foot. A property card is a plain link; a trade card carries an action (the
// enquiry) as well, so the photo and name link to the profile while the foot
// holds "Ask" and "View profile".

export interface DirectoryProvider {
    id: string;
    business_name: string;
    description: string | null;
    logo: string | null;
    headshot: string | null;
    photos: string[] | null;
    trade: string;
    callout_fee: any;
    hourly_rate: any;
    flat_fee: any;
    provides_quote: boolean;
    callout_waived: boolean;
    registration_number: string | null;
    does_gas: boolean;
    does_oil: boolean;
    does_emergency: boolean;
    does_scheduled: boolean;
}

export default function TradeCard({
    provider,
    regionLabels,
    regs,
    onAsk,
}: {
    provider: DirectoryProvider;
    regionLabels: string[];
    regs: any[];
    onAsk: () => void;
}) {
    const href = `/services/${provider.trade}/${provider.id}`;
    const photo = (provider.photos && provider.photos[0]) || provider.headshot || provider.logo || null;
    const coverage = regionLabels.join(' · ');

    const charges = provider.provides_quote
        ? 'Priced by quote'
        : [
            provider.hourly_rate ? '£' + provider.hourly_rate + ' an hour' : '',
            provider.flat_fee ? '£' + provider.flat_fee + ' a job' : '',
            calloutLine(provider.callout_fee, provider.callout_waived) || '',
        ].filter(Boolean).join(' · ');

    const verified = (regs || []).filter((r) => registrationVerified(r) && !registrationExpired(r))[0];

    const availability = [
        provider.does_emergency ? 'Emergency call-outs' : '',
        provider.does_scheduled ? 'Scheduled work' : '',
    ].filter(Boolean).join(' · ');

    return (
        <div className="flex flex-col">
            {/* Photo, inset in its own rounded box — headshot/logo/photo, or an
                initial-letter tile (slate, never a blank coloured disc). */}
            <Link href={href} className="group block">
                <div className="relative h-52 w-full overflow-hidden rounded-2xl bg-slate-100">
                    {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={getImageUrl(photo)}
                            alt={provider.business_name}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-4xl font-semibold text-slate-400">
                            {initialsFor(provider.business_name)}
                        </div>
                    )}
                </div>
            </Link>

            <div className="mt-3 flex flex-col">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                    {tradeLabel(provider.trade)}
                </p>
                <h3 className="mt-0.5 text-base font-bold text-slate-900">
                    <Link href={href} className="hover:underline">{provider.business_name}</Link>
                </h3>

                {coverage && (
                    <p className="mt-1 flex items-center gap-1.5 text-[13px] text-slate-500">
                        <MapPin className="h-3.5 w-3.5 flex-none text-slate-400" strokeWidth={1.75} />
                        <span className="truncate">{coverage}</span>
                    </p>
                )}

                {charges && (
                    <p className="mt-1.5 text-sm font-semibold text-slate-900">{charges}</p>
                )}

                {verified && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-emerald-800">
                        <ShieldCheck className="h-3.5 w-3.5 flex-none" strokeWidth={1.75} />
                        {schemeLabel(verified.scheme)} — checked by us
                    </p>
                )}

                {availability && (
                    <p className="mt-1 text-[13px] text-slate-500">{availability}</p>
                )}

                {/* The one short line about the first contact — it is a question
                    about availability, not a job to be priced. */}
                <p className="mt-3 text-[13px] text-slate-500">
                    Just ask if they’re free or could take a look.
                </p>

                {/* The action row — an emerald primary and a bordered secondary,
                    the card family's foot. */}
                <div className="mt-2 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onAsk}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800"
                    >
                        <MessageSquare className="h-4 w-4" strokeWidth={2} />
                        Ask {provider.business_name}
                    </button>
                    <Link
                        href={href}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-500"
                    >
                        Profile
                        <ArrowRight className="h-4 w-4" strokeWidth={2} />
                    </Link>
                </div>
            </div>
        </div>
    );
}
