import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, KeyRound, Wifi, MessageCircle, DoorOpen } from 'lucide-react';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { displayName } from '@/lib/utils';
import { stayCountdown } from '@/lib/bookingWindows';
import { bookingReleasesPrivateData } from '@/lib/bookingEntitlement';
import { checkInMethodTitle, checkInBlurb } from '@/lib/checkInMethods';
import CopyField from '@/components/arrival/CopyField';

export const dynamic = 'force-dynamic';

// "Getting there" — now the SECRETS screen and nothing else. The whole approach
// (where, the last bit, the times, parking, how you get in, the contact block,
// the offline promise) lives on the trip card, which used to duplicate a near-
// identical version of this page. What is left here is only the two things that
// must not sit on a card a guest might leave open on a train: the door code and
// the wifi password. They are revealed inside the three-day window, which is also
// the only time the card shows a link to this page — so it is reached with intent,
// close to arrival.

function dayName(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-GB', { weekday: 'long' });
}

export default async function ArrivalPage({ params }: { params: { bookingId: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/trips');

    const admin = adminClient();
    const { data: booking } = await admin
        .from('bookings')
        .select('id, guest_id, host_id, listing_id, check_in, check_out, status, payment_status')
        .eq('id', params.bookingId)
        .maybeSingle();
    if (!booking) redirect('/trips');

    // The guest, or someone they added to the trip — the same people TripGroup
    // promises the address and the way in.
    let allowed = booking.guest_id === user.id;
    if (!allowed) {
        const { data: companion } = await admin
            .from('booking_guests')
            .select('id').eq('booking_id', booking.id).eq('user_id', user.id).eq('status', 'active').maybeSingle();
        allowed = !!companion;
    }
    if (!allowed) redirect('/trips');

    // Being ON the booking is not enough to see the way in. The booking must be
    // a real, confirmed stay — an unpaid planted row (which any account can
    // create for free) or a paid request the host has not yet accepted has no
    // arrival details to give. This is the same rule profile_private and the
    // trips card draw; the door-code time window below is a SECOND gate on top,
    // not a substitute for this one. A non-confirmed booking lands back on
    // /trips, where it shows its real state. (Entitlement gating, PR #99 — kept
    // through the Getting-there-becomes-secrets rewrite.)
    if (!bookingReleasesPrivateData(booking)) redirect('/trips');

    // The secrets are only shown as arrival nears, so the door code is only
    // FETCHED then — outside the window it never enters this page's data, let
    // alone the rendered response. codeReady is computed before the reads for
    // exactly that reason.
    const now = new Date();
    const { phase, daysUntilCheckIn } = stayCountdown(booking, now);
    const codeReady = daysUntilCheckIn <= 3;

    // The listing's check-in method (public-safe), the host name for the fall-back
    // message, the wifi (own grant-less table) and the door code, read under the
    // service role only after the booking check above.
    const [{ data: listing }, { data: host }, { data: arrival }, { data: access }] = await Promise.all([
        admin.from('listings')
            .select('title, check_in_method')
            .eq('id', booking.listing_id).maybeSingle(),
        admin.from('profiles').select('full_name, preferred_name, show_full_name').eq('id', booking.host_id).maybeSingle(),
        admin.from('listing_arrival').select('wifi_name, wifi_password').eq('listing_id', booking.listing_id).maybeSingle(),
        // Inside the window we fetch the code itself; outside it we fetch only
        // listing_id, so the page can SAY a way in exists without the value ever
        // leaving the table. Selecting 'code' here — even to test existence —
        // would pull the secret into this request; we deliberately don't.
        codeReady
            ? admin.from('listing_access_codes').select('code').eq('listing_id', booking.listing_id).maybeSingle()
            : admin.from('listing_access_codes').select('listing_id').eq('listing_id', booking.listing_id).maybeSingle(),
    ]);
    if (!listing) redirect('/trips');

    const l: any = listing;
    const a: any = arrival || {};
    const doorCode: string | null = codeReady ? ((access && (access as any).code) || null) : null;
    // A code is on file, whether or not we've fetched its value yet.
    const hasCode = !!access;
    const method: string | null = l.check_in_method || null;

    const countdown =
        phase === 'before' ? `Your stay starts ${dayName(booking.check_in)} · in ${daysUntilCheckIn} days`
            : phase === 'tomorrow' ? `Your stay starts ${dayName(booking.check_in)} · tomorrow`
                : phase === 'today' ? 'Your stay starts today'
                    : phase === 'during' ? 'You’re staying now'
                        : null;

    const hostName = displayName(host, 'your host');

    const Section = ({ children }: { children: any }) => (
        <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200/80">{children}</div>
    );

    return (
        <div className="min-h-screen bg-stone-50">
            <div className="mx-auto max-w-lg px-4 sm:px-6 py-6">
                <Link href={`/trips#trip-${booking.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-800">
                    <ArrowLeft className="h-4 w-4" /> Your trips
                </Link>

                <div className="mt-4">
                    <div className="text-xs font-medium text-stone-500">{l.title}</div>
                    <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-stone-900">Getting there</h1>
                    {countdown && (
                        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">{countdown}</span>
                    )}
                    <p className="mt-2 text-sm text-stone-500">
                        The way in and the wifi for this stay. Everything else — where it is, the
                        journey, the times — is on your <Link href={`/trips#trip-${booking.id}`} className="font-medium text-emerald-700 underline">trip card</Link>.
                    </p>
                </div>

                {/* Getting in — the door code, or the check-in method when there's
                    no code, or a pointer to the host when there's neither. */}
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                        <KeyRound className="h-3.5 w-3.5" /> Getting in
                    </div>
                    {codeReady && doorCode ? (
                        <>
                            <div className="mt-1.5 text-3xl font-semibold tracking-[0.15em] text-stone-900">{doorCode}</div>
                            <p className="mt-0.5 text-xs text-emerald-700">Shown because your check-in is close</p>
                        </>
                    ) : hasCode ? (
                        <p className="mt-1.5 text-sm text-emerald-900/80">Your door code shows here a few days before you arrive.</p>
                    ) : method ? (
                        <div className="mt-1.5 flex items-start gap-2">
                            <DoorOpen className="mt-0.5 h-4 w-4 flex-none text-emerald-700" strokeWidth={1.75} />
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-emerald-900">{checkInMethodTitle(method)}</div>
                                {checkInBlurb(method) && <div className="text-sm text-emerald-800/90">{checkInBlurb(method)}</div>}
                            </div>
                        </div>
                    ) : (
                        <div className="mt-1.5">
                            <p className="text-sm text-emerald-900/80">
                                {hostName} hasn’t set a door code for this place — they’ll let you in, or tell
                                you how, in the messages.
                            </p>
                            <Link href={`/messages?b=${booking.id}`} className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-500">
                                <MessageCircle className="h-4 w-4" /> Message {hostName}
                            </Link>
                        </div>
                    )}
                </div>

                {/* Wifi — the name whenever the host set it; the password only in
                    the window, the same reveal the door code gets. */}
                {a.wifi_name && (
                    <Section>
                        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                            <Wifi className="h-3.5 w-3.5" /> Wifi
                        </div>
                        <div className="mt-1 text-sm text-stone-700">{a.wifi_name}</div>
                        {a.wifi_password && (
                            codeReady ? (
                                <div className="mt-1.5 flex items-center gap-2">
                                    <span className="font-mono text-sm text-stone-800">{a.wifi_password}</span>
                                    <CopyField value={a.wifi_password} label="Copy" />
                                </div>
                            ) : (
                                <p className="mt-1.5 text-sm text-stone-500">The password shows here a few days before you arrive.</p>
                            )
                        )}
                    </Section>
                )}
            </div>
        </div>
    );
}
