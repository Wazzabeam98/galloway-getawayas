import Link from 'next/link';
import { ChevronRight, CalendarCheck, Home, LogIn, LogOut } from 'lucide-react';
import { ukLongDate, ukDate } from '@/lib/dayKey';
import { untilBadgeLabel } from '@/components/WhenBadge';
import HostTodayAlerts from './HostTodayAlerts';

// One reservation, as the Today view needs it. Only the serialisable fields a
// card draws — the page has already resolved the guest's first name and the
// listing title with the service key, so nothing here re-queries.
export interface TodayStay {
    id: string;
    guestName: string;
    listingTitle: string;
    checkIn: string; // day key, yyyy-mm-dd
    checkOut: string; // day key, yyyy-mm-dd
    avatarUrl: string | null;
}

export interface TodayGroups {
    checkingIn: TodayStay[];
    hosting: TodayStay[];
    checkingOut: TodayStay[];
    arriving: TodayStay[];
}

function Avatar({ name, url }: { name: string; url: string | null }) {
    if (url) {
        // eslint-disable-next-line @next/next/no-img-element
        return <img src={url} alt="" className="h-11 w-11 flex-none rounded-full object-cover ring-1 ring-slate-200" />;
    }
    return (
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-slate-100 text-base font-semibold text-slate-500">
            {(name || 'G').slice(0, 1)}
        </span>
    );
}

function StayCard({ stay, dateLabel }: { stay: TodayStay; dateLabel: string }) {
    return (
        <Link
            href={`/dashboard/bookings/${stay.id}`}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)] transition hover:border-slate-300"
        >
            <Avatar name={stay.guestName} url={stay.avatarUrl} />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">{stay.guestName}</span>
                <span className="mt-0.5 block truncate text-[13px] text-slate-500">{stay.listingTitle}</span>
                <span className="mt-0.5 block text-[12px] font-medium text-slate-400">{dateLabel}</span>
            </span>
            <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
        </Link>
    );
}

function Section({
    title,
    icon: Icon,
    stays,
    label,
}: {
    title: string;
    icon: typeof Home;
    stays: TodayStay[];
    label: (stay: TodayStay) => string;
}) {
    if (!stays.length) return null;
    return (
        <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Icon className="h-4 w-4 text-slate-400" /> {title}
                <span className="text-slate-400">· {stays.length}</span>
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {stays.map((s) => (
                    <StayCard key={s.id} stay={s} dateLabel={label(s)} />
                ))}
            </div>
        </div>
    );
}

export default function HostToday({
    firstName,
    today,
    groups,
    hasBookings,
    firstSteps,
}: {
    firstName: string | null;
    today: string; // day key
    groups: TodayGroups;
    hasBookings: boolean;
    firstSteps: { label: string; href: string; done: boolean }[];
}) {
    const arrivingLabel = (s: TodayStay) => {
        const until = untilBadgeLabel(s.checkIn);
        return `Arrives ${until ? until.toLowerCase() : ukDate(s.checkIn)} · ${ukDate(s.checkIn)}`;
    };

    return (
        <section className="rounded-3xl bg-slate-50 p-5 sm:p-7">
            <div className="mb-5">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900">
                    {firstName ? `Hi ${firstName}` : 'Today'}
                </h1>
                <p className="mt-0.5 text-sm text-slate-500">{ukLongDate(today)}</p>
            </div>

            <HostTodayAlerts />

            {hasBookings ? (
                <div className="space-y-7">
                    <Section
                        title="Checking in today"
                        icon={LogIn}
                        stays={groups.checkingIn}
                        label={(s) => `Until ${ukDate(s.checkOut)}`}
                    />
                    <Section
                        title="Currently hosting"
                        icon={Home}
                        stays={groups.hosting}
                        label={(s) => `Checks out ${ukDate(s.checkOut)}`}
                    />
                    <Section
                        title="Checking out today"
                        icon={LogOut}
                        stays={groups.checkingOut}
                        label={(s) => `Arrived ${ukDate(s.checkIn)}`}
                    />
                    <Section
                        title="Arriving soon"
                        icon={CalendarCheck}
                        stays={groups.arriving}
                        label={arrivingLabel}
                    />

                    {/* Everything on the books, but nothing happening in the
                        window above — a quiet day, said plainly rather than with
                        an empty grid. */}
                    {!groups.checkingIn.length && !groups.hosting.length && !groups.checkingOut.length && !groups.arriving.length && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
                            <p className="text-sm font-medium text-slate-700">Nothing needs you today.</p>
                            <p className="mt-1 text-sm text-slate-500">
                                Your check-ins, checkouts and guests in residence will show here.
                            </p>
                        </div>
                    )}
                </div>
            ) : (
                // A new host with no bookings yet. A short, honest checklist of
                // what gets them to their first one, and a line saying this is
                // where the day's comings and goings will appear.
                <div className="rounded-2xl border border-slate-200 bg-white p-6">
                    <h2 className="text-lg font-semibold text-slate-900">Welcome to hosting</h2>
                    <p className="mt-1 text-sm text-slate-500">
                        A few steps to your first booking. Your check-ins, checkouts and messages will appear here once guests start booking.
                    </p>
                    <ul className="mt-5 space-y-2.5">
                        {firstSteps.map((step) => (
                            <li key={step.label}>
                                <Link
                                    href={step.href}
                                    className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 transition hover:border-slate-300"
                                >
                                    <span
                                        className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-bold ${
                                            step.done ? 'bg-emerald-600 text-white' : 'border-2 border-slate-300 text-transparent'
                                        }`}
                                        aria-hidden="true"
                                    >
                                        ✓
                                    </span>
                                    <span className={`flex-1 text-sm font-medium ${step.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                                        {step.label}
                                    </span>
                                    {!step.done && <ChevronRight className="h-4 w-4 flex-none text-slate-300" />}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}
