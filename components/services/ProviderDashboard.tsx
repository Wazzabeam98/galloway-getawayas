import Link from 'next/link';
import {
    CheckCircle2,
    Phone,
    Info,
    ArrowRight,
    AlertTriangle,
    Pencil,
    Inbox,
} from 'lucide-react';
import EnquiryActions from '@/components/services/EnquiryActions';

// The provider's own view of their business — the screen a tradesman or an
// experience-seller lands on when they log in. Until this existed an approved
// provider saw the ordinary traveller menu and nothing pointed at their
// business; the only "business" screen was the sign-up wizard reopened by URL.
//
// TWO PROVIDERS, ONE PAGE, ONE DIFFERENCE
//
// A host trade (a plumber) is paid off-platform — the site takes nothing from
// the job — so there is no payout to connect and "approved" already means
// "listed". A guest trade (a chef) is paid through the platform, so an
// approved provider who has not connected Stripe is approved-but-not-bookable,
// and the payout gate is the biggest thing on their page until it is done.
// The only thing that differs between the two is the hero and the right-hand
// money card; everything else is shared.
//
// THE LINE THIS HOLDS
//
// Nothing here counts down to a slot or says "confirmed". A date is always the
// day the host ASKED for, never one the tradesman agreed to — the same wording
// the enquiry emails and the host's own list already use, because there is no
// capacity model behind it. See lib/serviceEnquiries.requestedWhen.

export type DashboardEnquiry = {
    id: string;
    chip: 'new' | 'accepted' | 'declined' | 'closed';
    chipLabel: string;
    title: string;
    askedFor: string | null;
    sub: string;
    contactName?: string | null;
    contactPhone?: string | null;
    when?: string | null;
    replyBy?: string | null;
    answerHref?: string | null;
};

export type DashboardUpcoming = {
    id: string;
    day: string;
    month: string;
    title: string;
    window: string;
    contactName?: string | null;
};

export type ProviderDashboardProps = {
    businessName: string;
    tradeName: string;
    areaLabel: string;
    badge: string;
    // true for a host trade (off-platform, no payout gate); false for a guest
    // trade paid through the platform.
    offPlatform: boolean;
    // guest trades only: payouts connected and enabled.
    live: boolean;
    editHref: string;
    enquiries: DashboardEnquiry[];
    upcoming: DashboardUpcoming[];
    toAnswer: number;
    nextPayoutLabel?: string | null;
};

function StatusPill({ offPlatform, live }: { offPlatform: boolean; live: boolean }) {
    let text: string;
    let tone: string;
    if (offPlatform) {
        text = 'Listed · hosts can find you';
        tone = 'bg-emerald-50 text-emerald-800 border-emerald-200';
    } else if (live) {
        text = 'Live · guests can book you';
        tone = 'bg-emerald-50 text-emerald-800 border-emerald-200';
    } else {
        text = 'Not bookable yet';
        tone = 'bg-amber-50 text-amber-800 border-amber-200';
    }
    return (
        <span className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border ${tone}`}>
            <span className={`w-2 h-2 rounded-full ${offPlatform || live ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {text}
        </span>
    );
}

function Chip({ chip, label }: { chip: DashboardEnquiry['chip']; label: string }) {
    const tone =
        chip === 'new'
            ? 'bg-amber-50 text-amber-800 border-amber-200'
            : chip === 'accepted'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-slate-100 text-slate-500 border-slate-200';
    return (
        <span className={`flex-none mt-0.5 text-[11px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full border ${tone}`}>
            {label}
        </span>
    );
}

export default function ProviderDashboard(props: ProviderDashboardProps) {
    const {
        businessName, tradeName, areaLabel, badge,
        offPlatform, live, editHref, enquiries, upcoming, toAnswer, nextPayoutLabel,
    } = props;

    return (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-24">
            {/* STATUS — one honest state, up top */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                        {businessName}
                    </h1>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
                        <span>{tradeName}</span>
                        {areaLabel && (<><span className="text-slate-300">·</span><span>{areaLabel}</span></>)}
                        <span className="text-slate-300">·</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                            <CheckCircle2 className="w-4 h-4" strokeWidth={2.2} />
                            {badge}
                        </span>
                    </div>
                </div>
                <StatusPill offPlatform={offPlatform} live={live} />
            </div>

            {/* HERO — the one difference between the two provider types */}
            <div className="mt-6">
                {offPlatform ? (
                    // Host trade: listed, no payout gate.
                    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-emerald-50 border border-emerald-200">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-none" strokeWidth={2.2} />
                        <b className="text-emerald-800 font-bold">You&rsquo;re listed.</b>
                        <span className="text-sm text-slate-600">
                            Hosts across your area can find you and send work your way.
                        </span>
                    </div>
                ) : live ? (
                    // Guest trade, connected: live.
                    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-emerald-50 border border-emerald-200">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-none" strokeWidth={2.2} />
                        <b className="text-emerald-800 font-bold">You&rsquo;re live.</b>
                        <span className="text-sm text-slate-600">Payouts connected — guests can book you.</span>
                        {nextPayoutLabel && (
                            <span className="ml-auto text-sm text-slate-500">
                                Next payout <b className="text-slate-800">{nextPayoutLabel}</b>
                            </span>
                        )}
                    </div>
                ) : (
                    // Guest trade, not connected: the payout gate is the hero.
                    <div className="relative overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/60 p-5 sm:p-6">
                        <span className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-800">
                            <AlertTriangle className="w-4 h-4" strokeWidth={2} />
                            One step between you and your first booking
                        </div>
                        <h2 className="mt-2.5 text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
                            Set up payouts to go live
                        </h2>
                        <p className="mt-1.5 text-sm text-slate-600 max-w-xl">
                            You&rsquo;re approved — but guests can&rsquo;t book you until we know where to send your
                            money. It takes a couple of minutes through Stripe, and you go live the moment it&rsquo;s done.
                        </p>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <Link
                                href={editHref}
                                className="inline-flex items-center gap-2 font-bold text-sm text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl px-5 py-3 transition"
                            >
                                Set up payouts <ArrowRight className="w-4 h-4" strokeWidth={2.4} />
                            </Link>
                            <span className="text-xs text-slate-400">
                                Secure, handled by Stripe · you can leave and come back
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* SECTIONS */}
            <div className="mt-6 grid gap-4 lg:grid-cols-[1.55fr_1fr] items-start">
                {/* LEFT */}
                <div className="flex flex-col gap-4">
                    {/* Requests */}
                    <section id="requests" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 scroll-mt-24">
                        <header className="flex items-center gap-3 pb-1">
                            <h3 className="font-bold text-slate-900">Requests</h3>
                            {toAnswer > 0 && (
                                <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                    {toAnswer} to answer
                                </span>
                            )}
                        </header>

                        {enquiries.length === 0 ? (
                            <div className="text-center text-slate-500 py-8">
                                <Inbox className="w-6 h-6 text-slate-300 mx-auto mb-2" strokeWidth={1.7} />
                                <div className="font-semibold text-slate-700 text-sm">No requests yet</div>
                                <div className="text-sm mt-0.5">
                                    {offPlatform
                                        ? 'When a host in your area asks for you, it lands here.'
                                        : 'You&rsquo;ll appear to guests — and requests land here — once payouts are set up.'}
                                </div>
                            </div>
                        ) : (
                            <ul>
                                {enquiries.map((e, i) => (
                                    <li key={e.id} className={`flex items-start gap-3 py-3.5 ${i === 0 ? '' : 'border-t border-slate-100'}`}>
                                        <Chip chip={e.chip} label={e.chipLabel} />
                                        <div className="min-w-0 flex-1">
                                            <div className="font-semibold text-sm text-slate-900">{e.title}</div>
                                            {e.askedFor && (
                                                <div className="text-[12.5px] font-semibold text-emerald-800 mt-0.5">{e.askedFor}</div>
                                            )}
                                            {e.sub && <div className="text-[13px] text-slate-500 mt-0.5">{e.sub}</div>}
                                            {/* Contact only once accepted. */}
                                            {e.chip === 'accepted' && e.contactPhone && (
                                                <div className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-800">
                                                    <Phone className="w-3.5 h-3.5" strokeWidth={2} />
                                                    {e.contactPhone}{e.contactName ? ` · ${e.contactName}` : ''}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-none text-right">
                                            {e.chip === 'new' && <EnquiryActions enquiryId={e.id} />}
                                            {e.replyBy && e.chip === 'new' && (
                                                <div className="text-[11.5px] font-semibold text-amber-800 mt-1.5 whitespace-nowrap">Reply by {e.replyBy}</div>
                                            )}
                                            {e.when && e.chip !== 'new' && (
                                                <div className="text-[12px] text-slate-400 mt-0.5 whitespace-nowrap">{e.when}</div>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    {/* Upcoming work — host trades only */}
                    {offPlatform && upcoming.length > 0 && (
                        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                            <header className="flex items-center gap-3 pb-1">
                                <h3 className="font-bold text-slate-900">Upcoming work</h3>
                                <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                    {upcoming.length} planned
                                </span>
                            </header>
                            <ul>
                                {upcoming.map((u, i) => (
                                    <li key={u.id} className={`flex items-center gap-3.5 py-3.5 ${i === 0 ? '' : 'border-t border-slate-100'}`}>
                                        <div className="flex-none w-13 text-center border border-slate-200 rounded-xl px-2 py-1.5 bg-slate-50">
                                            <div className="font-extrabold text-lg leading-none text-slate-900">{u.day}</div>
                                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-0.5">{u.month}</div>
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-semibold text-sm text-slate-900">{u.title}</div>
                                            <div className="text-[13px] text-slate-500 mt-0.5">
                                                <b className="text-slate-700 font-semibold">Asked for</b> {u.window}
                                                {u.contactName ? ` · ${u.contactName}` : ''}
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-3 flex items-start gap-2 text-[12.5px] text-slate-600 bg-slate-50 border border-dashed border-slate-300 rounded-xl px-3 py-2.5">
                                <Info className="w-4 h-4 text-slate-400 flex-none mt-0.5" strokeWidth={2} />
                                <span>
                                    These are the days and windows the host <b className="text-slate-700 font-semibold">asked for</b>,
                                    not slots you&rsquo;ve committed to. You agree the actual time with them — nothing here holds a booking.
                                </span>
                            </div>
                        </section>
                    )}
                </div>

                {/* RIGHT */}
                <div className="flex flex-col gap-4">
                    {/* How you're paid */}
                    {offPlatform ? (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                            <h3 className="font-bold text-sm text-slate-900">Getting paid</h3>
                            <div className="inline-flex items-center gap-2 mt-2 text-sm font-semibold text-emerald-800">
                                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                Direct with the host
                            </div>
                            <p className="mt-2 text-[13px] text-slate-500">
                                You agree the price and take payment yourself — Galloway Getaways takes nothing from the
                                job. No payouts to set up.
                            </p>
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                            <h3 className="font-bold text-sm text-slate-900">Payouts</h3>
                            {live ? (
                                <>
                                    <div className="inline-flex items-center gap-2 mt-2 text-sm font-semibold text-emerald-800">
                                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                                        Connected
                                    </div>
                                    <Link href={editHref} className="inline-flex items-center gap-1 mt-3 text-[13px] font-semibold text-emerald-800 hover:underline">
                                        Statements &amp; bank details <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.4} />
                                    </Link>
                                </>
                            ) : (
                                <>
                                    <div className="inline-flex items-center gap-2 mt-2 text-sm font-semibold text-amber-800">
                                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                                        Not set up
                                    </div>
                                    <p className="mt-2 text-[13px] text-slate-500">
                                        Connect a bank account through Stripe to take bookings and get paid.
                                    </p>
                                    <Link href={editHref} className="inline-flex items-center gap-1 mt-3 text-[13px] font-semibold text-emerald-800 hover:underline">
                                        Set up now <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.4} />
                                    </Link>
                                </>
                            )}
                        </div>
                    )}

                    {/* Profile — both. One way in, to one editor. */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                        <h3 className="font-bold text-sm text-slate-900">Your profile</h3>
                        <p className="mt-1 text-[13px] text-slate-500">
                            What hosts see — change all of it in one place.
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-3">
                            {['Services', 'Rates & call-out', 'Coverage area', 'Photos', 'Registrations'].map((t) => (
                                <span key={t} className="text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2 py-0.5">
                                    {t}
                                </span>
                            ))}
                        </div>
                        <Link href="/services/dashboard/edit" className="inline-flex items-center gap-1.5 mt-3 text-[13px] font-semibold text-emerald-800 hover:underline">
                            <Pencil className="w-3.5 h-3.5" strokeWidth={2} /> Edit your business
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
