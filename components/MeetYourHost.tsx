import Image from 'next/image';
import { BadgeCheck, Star, ShieldCheck } from 'lucide-react';
import { getImageUrl } from '@/lib/utils';

export type CoHost = { name: string; avatarUrl: string | null };

// "Meet your host" in Airbnb's two-column shape. Left: a raised card with the
// host's photo (initial fallback) and a verified check on it, their name, and
// Reviews / Rating / Years hosting stacked down the right with thin dividers —
// then the bio (and any profile facts they've filled in) beneath it. Right: a
// short note on what "verified" means, the co-hosts, the host's response rate
// and time, and a payment-safety line. No Message host button yet (pre-booking
// threads are their own feature). On a phone the two columns stack.
//
// The raised card uses the one lifted-card recipe (border + the single shadow)
// from CLAUDE.md, on the slate-50 page — the host asked for it raised.
export default function MeetYourHost({
    firstName,
    avatarUrl,
    verified,
    bio,
    sinceYear,
    monthsHosting,
    ratingAvg,
    ratingCount,
    showScore,
    coHosts,
    responseRatePercent,
    typicalLabel,
}: {
    firstName: string;
    avatarUrl: string | null;
    verified: boolean;
    bio: string | null;
    sinceYear: number | null;
    monthsHosting: number | null;
    ratingAvg: number;
    ratingCount: number;
    showScore: boolean;
    coHosts: CoHost[];
    responseRatePercent: number;
    typicalLabel: string;
}) {
    const Avatar = ({ url, name, size }: { url: string | null; name: string; size: number }) => (
        <div
            className="rounded-full overflow-hidden bg-slate-900 text-white flex items-center justify-center font-semibold flex-shrink-0"
            style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
            {url ? (
                <Image src={getImageUrl(url)} alt={`${name}`} width={size} height={size} className="w-full h-full object-cover" />
            ) : (
                name.charAt(0)
            )}
        </div>
    );

    // The headline numbers down the right of the card. Reviews and rating show
    // only once there are some (so a brand-new host never shows a 0 or a 0.0),
    // but time hosting is ALWAYS shown — it is the one stat a new host has, and
    // it's what stops the card reading as empty. Airbnb does exactly this: a new
    // host's card is just photo, name and "Months hosting", sized to fit.
    const stats: { value: React.ReactNode; label: string }[] = [];
    if (ratingCount > 0) stats.push({ value: ratingCount, label: ratingCount === 1 ? 'Review' : 'Reviews' });
    if (showScore) {
        stats.push({
            value: (
                <span className="inline-flex items-center gap-1">
                    {ratingAvg.toFixed(2)}
                    <Star className="h-3.5 w-3.5 fill-slate-900" />
                </span>
            ),
            label: 'Rating',
        });
    }
    if (monthsHosting != null) {
        if (monthsHosting >= 12) {
            const years = Math.floor(monthsHosting / 12);
            stats.push({ value: years, label: years === 1 ? 'Year hosting' : 'Years hosting' });
        } else {
            // In their first year it reads in months ("3 / Months hosting"); the
            // first few weeks round up to 1 so it never shows "0 months".
            const months = Math.max(1, monthsHosting);
            stats.push({ value: months, label: months === 1 ? 'Month hosting' : 'Months hosting' });
        }
    }

    return (
        <section id="host" className="mt-8 pt-8 border-t scroll-mt-24">
            <h2 className="text-xl md:text-2xl font-bold text-slate-900">Meet your host</h2>

            <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-12">
                {/* Left: the raised identity card, then the bio below it. The
                    card is sized to its content (w-fit), so a new host with only
                    one stat gets a compact card rather than a wide, empty one —
                    the way Airbnb's new-host card hugs its content. */}
                <div>
                    <div className="w-fit max-w-sm rounded-2xl border border-slate-200 bg-white shadow-[0_6px_16px_rgba(0,0,0,0.12)] p-6">
                        <div className="flex items-center gap-5">
                            <div className="flex flex-col items-center text-center">
                                <div className="relative">
                                    <Avatar url={avatarUrl} name={firstName} size={104} />
                                    {verified && (
                                        <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-white">
                                            <BadgeCheck className="h-7 w-7 fill-emerald-600 text-white" />
                                        </span>
                                    )}
                                </div>
                                <div className="mt-3 text-2xl font-bold text-slate-900">{firstName}</div>
                                <div className="text-xs font-medium text-slate-500">Host</div>
                            </div>

                            {stats.length > 0 && (
                                <div className="flex-1 divide-y divide-slate-100 border-l border-slate-100 pl-5">
                                    {stats.map((s) => (
                                        <div key={s.label} className="py-2.5 first:pt-0 last:pb-0">
                                            <div className="text-lg font-bold leading-tight text-slate-900">{s.value}</div>
                                            <div className="text-[11px] text-slate-500">{s.label}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* "Hosting since" lives inside the card now, under a thin
                            rule — part of the host's identity, not a loose line
                            floating beneath it. */}
                        {sinceYear && (
                            <div className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-500">
                                Hosting since {sinceYear}
                            </div>
                        )}
                    </div>

                    {bio && (
                        <p className="mt-4 text-slate-600 whitespace-pre-line">{bio}</p>
                    )}
                </div>

                {/* Right: what verified means, co-hosts, host details, safety. */}
                <div className="space-y-6">
                    {verified && (
                        <div>
                            <h3 className="flex items-center gap-2 font-semibold text-slate-900">
                                <BadgeCheck className="h-5 w-5 text-emerald-700" />
                                {firstName} is a verified host
                            </h3>
                            <p className="mt-1 text-sm text-slate-600">
                                Stripe has confirmed {firstName}&apos;s identity, so you know who you&apos;re
                                booking with before you pay.
                            </p>
                        </div>
                    )}

                    {coHosts.length > 0 && (
                        <div>
                            <div className="mb-2 text-sm font-semibold text-slate-900">
                                {coHosts.length === 1 ? 'Co-host' : 'Co-hosts'}
                            </div>
                            <div className="flex flex-wrap gap-x-6 gap-y-3">
                                {coHosts.map((c, i) => (
                                    <div key={i} className="flex items-center gap-2.5">
                                        <Avatar url={c.avatarUrl} name={c.name} size={40} />
                                        <span className="text-sm font-medium text-slate-800">{c.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Response rate and time: every host has both. They start at
                        100% and "within a day" and only move with real history,
                        so this block always shows. */}
                    <div>
                        <div className="mb-2 text-sm font-semibold text-slate-900">Host details</div>
                        <div className="space-y-1 text-sm text-slate-700">
                            <div>Response rate: {responseRatePercent}%</div>
                            <div>Responds {typicalLabel}</div>
                        </div>
                    </div>

                    <div className="flex items-start gap-2 border-t border-slate-100 pt-4 text-sm text-slate-500">
                        <ShieldCheck className="mt-0.5 h-4 w-4 flex-none text-slate-400" />
                        <span>To help protect your payment, always pay and message through Galloway Getaways.</span>
                    </div>
                </div>
            </div>
        </section>
    );
}
