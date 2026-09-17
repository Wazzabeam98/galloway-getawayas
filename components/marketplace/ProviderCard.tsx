import Link from 'next/link';
import { shapeCue } from '@/lib/serviceSlots';
import { BadgeCheck, MapPin } from 'lucide-react';
import { fromPriceLabel, nextSessionLabel, cardLocationLine } from '@/components/marketplace/present';
import type { MpProvider } from '@/lib/experiencesData';

// One provider card, shared by the against-a-stay grid and the public browse
// grid — same shop window either way. The only difference is where it links, so
// the caller passes the href. Rules: first name only, "Verified business" (no
// stars, no bookings count).
export default function ProviderCard({ p, href }: { p: MpProvider; href: string }) {
    const who = p.byline || p.business_name;
    return (
        <Link
            href={href}
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
                        {p.byline || p.based_line || 'Local provider'}
                    </span>
                    <span className="ml-auto flex-none inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/15">
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified business
                    </span>
                </div>

                {p.description ? (
                    <p className="mt-2 text-sm leading-relaxed text-slate-600 line-clamp-2">{p.description}</p>
                ) : null}

                {cardLocationLine(p) ? (
                    <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                        <MapPin className="h-3.5 w-3.5 flex-none" aria-hidden />
                        <span className="min-w-0 truncate">{cardLocationLine(p)}</span>
                    </p>
                ) : null}

                <div className="mt-4 flex items-end justify-between gap-3 pt-1">
                    <div className="text-slate-900">
                        <span className="text-base font-semibold">{fromPriceLabel(p)}</span>
                    </div>
                    {p.shape === 'slot' ? (
                        <span className="text-xs text-slate-500">{nextSessionLabel(p)}</span>
                    ) : (
                        <span className="text-xs font-medium text-emerald-700 opacity-0 transition group-hover:opacity-100">View →</span>
                    )}
                </div>
            </div>
        </Link>
    );
}
