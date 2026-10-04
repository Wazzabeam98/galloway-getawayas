import Image from 'next/image';
import { BadgeCheck, Star, Clock, MessageCircle } from 'lucide-react';
import { getImageUrl } from '@/lib/utils';

export type CoHost = { name: string; avatarUrl: string | null };

// "Meet your host" — Airbnb's host card: the photo, the headline numbers
// (reviews, rating, years hosting), the host's own words, the co-hosts, and how
// responsive they are. A FLAT bordered card on the tinted page: with no "Message
// host" button on it (that waits on pre-booking threads), nothing here is a
// surface a guest acts on — it's trust they read — so it doesn't take the lift.
//
// Everything is resolved on the server before it reaches here: only first names
// and the public booleans cross to the browser (the name columns are anon-
// revoked), exactly as the old inline block did.
export default function MeetYourHost({
    firstName,
    avatarUrl,
    verified,
    bio,
    sinceYear,
    yearsHosting,
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
    yearsHosting: number | null;
    ratingAvg: number;
    ratingCount: number;
    showScore: boolean;
    coHosts: CoHost[];
    responseRatePercent: number | null;
    typicalLabel: string | null;
}) {
    const Avatar = ({ url, name, size }: { url: string | null; name: string; size: number }) => (
        <div
            className="rounded-full overflow-hidden bg-slate-900 text-white flex items-center justify-center font-semibold flex-shrink-0"
            style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
            {url ? (
                <Image
                    src={getImageUrl(url)}
                    alt={`${name}, host`}
                    width={size}
                    height={size}
                    className="w-full h-full object-cover"
                />
            ) : (
                name.charAt(0)
            )}
        </div>
    );

    // The headline numbers. Rating only once a place has enough reviews to show a
    // score (below that it reads "New"), so the stat is dropped rather than
    // printing a 0.0 that one review could swing.
    const stats: { value: string; label: string }[] = [];
    if (ratingCount > 0) stats.push({ value: String(ratingCount), label: ratingCount === 1 ? 'Review' : 'Reviews' });
    if (showScore) stats.push({ value: ratingAvg.toFixed(2), label: 'Rating' });
    if (yearsHosting && yearsHosting >= 1) {
        stats.push({ value: String(yearsHosting), label: yearsHosting === 1 ? 'Year hosting' : 'Years hosting' });
    }

    const hasResponse = responseRatePercent != null || typicalLabel;

    return (
        <section id="host" className="mt-8 pt-8 border-t scroll-mt-24">
            <h2 className="text-xl font-semibold text-slate-900">Meet your host</h2>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6">
                <div className="flex items-center gap-4">
                    <Avatar url={avatarUrl} name={firstName} size={72} />
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-lg font-bold text-slate-900">{firstName}</span>
                            {verified && (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                                    <BadgeCheck className="w-3.5 h-3.5" /> Verified host
                                </span>
                            )}
                        </div>
                        {sinceYear && (
                            <div className="text-sm text-slate-500">Hosting since {sinceYear}</div>
                        )}
                        {verified && (
                            <div className="text-sm text-slate-500">
                                Stripe has confirmed {firstName}&apos;s identity.
                            </div>
                        )}
                    </div>
                </div>

                {stats.length > 0 && (
                    <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-slate-100 pt-5">
                        {stats.map((s) => (
                            <div key={s.label} className="flex items-baseline gap-1.5">
                                <span className="text-lg font-bold text-slate-900 inline-flex items-center gap-1">
                                    {s.label === 'Rating' && <Star className="h-4 w-4 fill-slate-900" />}
                                    {s.value}
                                </span>
                                <span className="text-sm text-slate-500">{s.label}</span>
                            </div>
                        ))}
                    </div>
                )}

                {bio && (
                    <p className="mt-5 text-slate-600 whitespace-pre-line">{bio}</p>
                )}

                {hasResponse && (
                    <div className="mt-5 space-y-1.5 border-t border-slate-100 pt-5 text-sm text-slate-700">
                        {responseRatePercent != null && (
                            <div className="flex items-center gap-2">
                                <MessageCircle className="h-4 w-4 text-slate-500" />
                                <span>
                                    <span className="font-semibold text-slate-900">Response rate:</span>{' '}
                                    {responseRatePercent}%
                                </span>
                            </div>
                        )}
                        {typicalLabel && (
                            <div className="flex items-center gap-2">
                                <Clock className="h-4 w-4 text-slate-500" />
                                <span>
                                    <span className="font-semibold text-slate-900">Responds</span> {typicalLabel}
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {coHosts.length > 0 && (
                    <div className="mt-5 border-t border-slate-100 pt-5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {coHosts.length === 1 ? 'Co-host' : 'Co-hosts'}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
                            {coHosts.map((c, i) => (
                                <div key={i} className="flex items-center gap-2.5">
                                    <Avatar url={c.avatarUrl} name={c.name} size={40} />
                                    <span className="text-sm font-medium text-slate-800">{c.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
