import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { loadTripsList, type TripItem, type TripStay, type TripExperience } from '@/lib/tripsList';
import TripsMap from '@/components/TripsMap';
import { CalendarDays, Users, MapPin, ChevronRight, Clock } from 'lucide-react';

export const dynamic = 'force-dynamic';

// "Your trips" — stays and experiences together, for EVERY signed-in account
// (guests and providers alike, reached from the account menu). Split Upcoming /
// Past, soonest first, with a map of the stays beside the list on desktop and a
// single column on phone. Built in the card family the rest of the site uses.

function fmtDay(key: string): string {
    try { return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(key + 'T12:00:00Z')); }
    catch { return key; }
}
function prettyTime(t: string | null): string {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (m ? ':' + String(m).padStart(2, '0') : '') + ampm;
}
function partyLabel(n: number | null): string {
    if (!n || n < 1) return '';
    return n + (n === 1 ? ' guest' : ' guests');
}

function Photo({ src, alt }: { src: string | null; alt: string }) {
    return (
        <div className="aspect-[16/10] w-full overflow-hidden rounded-xl bg-slate-100">
            {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={alt} className="h-full w-full object-cover" />
            ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-300"><MapPin className="h-8 w-8" /></div>
            )}
        </div>
    );
}

function ExperienceRow({ exp }: { exp: TripExperience }) {
    return (
        <Link href={`/experiences/order/${exp.id}`}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 transition hover:border-slate-300">
            <div className="h-12 w-12 flex-none overflow-hidden rounded-lg bg-slate-100">
                {exp.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={exp.photo} alt="" className="h-full w-full object-cover" />
                ) : null}
            </div>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900">{exp.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[13px] text-slate-500">
                    <span>{fmtDay(exp.date)}{exp.time ? ' · ' + prettyTime(exp.time) : ''}</span>
                    {exp.pending && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Awaiting reply</span>}
                </div>
            </div>
            <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
        </Link>
    );
}

function StayCard({ stay }: { stay: TripStay }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
            <Link href={`/trips/${stay.id}`} className="block">
                <Photo src={stay.photo} alt={stay.title} />
                <div className="mt-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-slate-900">{stay.title}</div>
                        {stay.location && <div className="mt-0.5 truncate text-[13px] text-slate-500">{stay.location}</div>}
                    </div>
                    <ChevronRight className="mt-1 h-5 w-5 flex-none text-slate-300" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-slate-400" />{fmtDay(stay.checkIn)} – {fmtDay(stay.checkOut)}</span>
                    {stay.guests ? <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-slate-400" />{partyLabel(stay.guests)}</span> : null}
                </div>
            </Link>
            {stay.experiences.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Experiences on this stay</div>
                    <div className="space-y-2">
                        {stay.experiences.map((e) => <ExperienceRow key={e.id} exp={e} />)}
                    </div>
                </div>
            )}
        </div>
    );
}

function ExperienceCard({ exp }: { exp: TripExperience }) {
    return (
        <Link href={`/experiences/order/${exp.id}`}
            className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)] transition hover:border-slate-300">
            <Photo src={exp.photo} alt={exp.title} />
            <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-slate-900">{exp.title}</div>
                    {exp.providerName && <div className="mt-0.5 truncate text-[13px] text-slate-500">{exp.providerName}</div>}
                </div>
                <ChevronRight className="mt-1 h-5 w-5 flex-none text-slate-300" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-500">
                <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-slate-400" />{fmtDay(exp.date)}</span>
                {exp.time ? <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-slate-400" />{prettyTime(exp.time)}</span> : null}
                {exp.party ? <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-slate-400" />{partyLabel(exp.party)}</span> : null}
                {exp.pending && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Awaiting reply</span>}
            </div>
        </Link>
    );
}

function Section({ title, items }: { title: string; items: TripItem[] }) {
    if (!items.length) return null;
    return (
        <section className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</h2>
            <div className="mt-3 space-y-4">
                {items.map((it) => it.kind === 'stay'
                    ? <StayCard key={'s' + it.id} stay={it} />
                    : <ExperienceCard key={'e' + it.exp.id} exp={it.exp} />)}
            </div>
        </section>
    );
}

export default async function TripsPage() {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const admin = adminClient();
    const { upcoming, past, points } = await loadTripsList(admin, user.id);
    const empty = upcoming.length === 0 && past.length === 0;

    return (
        <div className="mx-auto max-w-6xl px-4 py-8">
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                <span aria-hidden>←</span> Home
            </Link>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">Your trips</h1>

            {empty ? (
                <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                    <p className="text-slate-600">Nothing booked yet.</p>
                    <div className="mt-4 flex flex-wrap justify-center gap-3">
                        <Link href="/" className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">Find a place to stay</Link>
                        <Link href="/experiences/browse" className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 hover:border-slate-400">Browse experiences</Link>
                    </div>
                </div>
            ) : (
                <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_minmax(320px,400px)]">
                    <div>
                        <Section title="Upcoming" items={upcoming} />
                        <Section title="Past" items={past} />
                    </div>
                    {points.length > 0 && (
                        <div className="lg:sticky lg:top-6 lg:self-start">
                            <TripsMap points={points} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
