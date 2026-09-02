import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, MapPin, Navigation, KeyRound, LogIn, LogOut, CornerDownRight,
    Car, Wifi, Phone, MessageCircle, Grid3x3, CloudOff,
} from 'lucide-react';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { displayName, formatTime } from '@/lib/utils';
import CopyField from '@/components/arrival/CopyField';

export const dynamic = 'force-dynamic';

// "Getting there" — the screen a guest opens on the day, designed for a cottage
// down a track with patchy signal, not a city flat. Every section is optional
// and renders only when the host has filled it: a host who wrote nothing still
// gives a real screen (address, times, call the host), never a shell of blanks.

function daysUntil(dateStr: string): number {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - today.getTime()) / 86400000);
}
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
        .select('id, guest_id, host_id, listing_id, check_in, check_out, status')
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

    // The door code is only shown as arrival nears, so it is only FETCHED then —
    // outside the window it never enters this page's data, let alone the rendered
    // response. codeReady is computed before the reads for exactly that reason.
    const until = daysUntil(booking.check_in);
    const codeReady = until <= 3;

    // The listing's public-safe fields and the arrival secrets (own grant-less
    // table) are read under the service role, only after the booking check above.
    const [{ data: listing }, { data: host }, { data: arrival }, { data: access }] = await Promise.all([
        admin.from('listings')
            .select('title, location, street_address, postcode, latitude, longitude, check_in_time, check_in_end_time, check_out_time')
            .eq('id', booking.listing_id).maybeSingle(),
        admin.from('profiles').select('full_name, preferred_name, show_full_name, phone').eq('id', booking.host_id).maybeSingle(),
        admin.from('listing_arrival').select('arrival_directions, parking_info, wifi_name, wifi_password, what3words').eq('listing_id', booking.listing_id).maybeSingle(),
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
    const hasCoords = l.latitude != null && l.longitude != null && !(l.latitude === 0 && l.longitude === 0);
    const addressLines = [l.street_address, [l.postcode, l.location].filter(Boolean).join(', ')].filter(Boolean);
    const addressString = [l.street_address, l.postcode, l.location].filter(Boolean).join(', ');

    // Directions point at the REAL location, or the address for the maps app to
    // geocode — never the town-centre fallback, which would send them wrong.
    const dest = hasCoords ? l.latitude + ',' + l.longitude : encodeURIComponent(addressString);
    const directionsUrl = addressString || hasCoords
        ? 'https://www.google.com/maps/dir/?api=1&destination=' + dest
        : null;

    const started = new Date(booking.check_out) >= new Date() && until <= 0;
    const countdown = until > 1 ? `Your stay starts ${dayName(booking.check_in)} · in ${until} days`
        : until === 1 ? `Your stay starts ${dayName(booking.check_in)} · tomorrow`
            : started ? 'You’re staying now' : null;

    const hostName = displayName(host, 'your host');
    const hostPhone = host && (host as any).phone;

    const Section = ({ children }: { children: any }) => (
        <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200/80">{children}</div>
    );
    const Label = ({ icon, text, tone = 'stone' }: { icon: any; text: string; tone?: string }) => (
        <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${tone === 'amber' ? 'text-amber-700' : tone === 'emerald' ? 'text-emerald-700' : 'text-stone-500'}`}>{icon} {text}</div>
    );

    return (
        <div className="min-h-screen bg-stone-50">
            <div className="mx-auto max-w-lg px-4 sm:px-6 py-6">
                <Link href="/trips" className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-800">
                    <ArrowLeft className="h-4 w-4" /> Your trips
                </Link>

                <div className="mt-4">
                    <div className="text-xs font-medium text-stone-500">{l.title}</div>
                    <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-stone-900">Getting there</h1>
                    {countdown && (
                        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">{countdown}</span>
                    )}
                </div>

                {/* Where, and how to get there */}
                <Section>
                    <Label icon={<MapPin className="h-3.5 w-3.5" />} text="Where" />
                    <div className="mt-1.5">
                        {addressLines.length ? addressLines.map((line: string, i: number) => (
                            <div key={i} className={i === 0 ? 'text-sm font-medium text-stone-900' : 'text-sm text-stone-600'}>{line}</div>
                        )) : <div className="text-sm text-stone-500">Ask {hostName} for the exact address in the messages.</div>}
                    </div>
                    {a.what3words && (
                        <div className="mt-2 flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700"><Grid3x3 className="h-3.5 w-3.5" /> {a.what3words}</span>
                            <CopyField value={a.what3words} label="Copy" />
                        </div>
                    )}
                    {!hasCoords && addressString && (
                        <p className="mt-2 text-xs text-stone-400">No pin saved for this cottage yet — directions use the address.</p>
                    )}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        {directionsUrl && (
                            <a href={directionsUrl} target="_blank" rel="noreferrer"
                                className="inline-flex items-center justify-center gap-2 rounded-lg bg-stone-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800">
                                <Navigation className="h-4 w-4" /> Get directions
                            </a>
                        )}
                        {addressString && <CopyField value={addressString} label="Copy address" />}
                    </div>
                    {directionsUrl && <p className="mt-1.5 text-center text-[11px] text-stone-400">Opens your maps app</p>}
                </Section>

                {/* The last bit — the host's own words for what sat-nav gets wrong */}
                {a.arrival_directions && (
                    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <Label icon={<CornerDownRight className="h-3.5 w-3.5" />} text="The last bit" tone="amber" />
                        <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-amber-950">{a.arrival_directions}</p>
                    </div>
                )}

                {/* Getting in — shows once a code is on file. The value itself only
                    lands in the page within the three-day window; before that the
                    guest gets the reassurance without the secret. */}
                {(doorCode || hasCode) && (
                    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <Label icon={<KeyRound className="h-3.5 w-3.5" />} text="Getting in" tone="emerald" />
                        {codeReady && doorCode ? (
                            <>
                                <div className="mt-1.5 text-2xl font-semibold tracking-[0.15em] text-stone-900">{doorCode}</div>
                                <p className="mt-0.5 text-xs text-emerald-700">Shown because your check-in is close</p>
                            </>
                        ) : (
                            <p className="mt-1.5 text-sm text-emerald-900/80">Your way in shows here a few days before you arrive.</p>
                        )}
                    </div>
                )}

                {/* Check-in / checkout */}
                <div className="mt-3 grid grid-cols-2 gap-3">
                    <Section>
                        <Label icon={<LogIn className="h-3.5 w-3.5" />} text="Check-in" />
                        <div className="mt-1 text-base font-semibold text-stone-900">
                            {formatTime(l.check_in_time) ? 'from ' + formatTime(l.check_in_time) : '—'}
                        </div>
                        {formatTime(l.check_in_end_time) && <div className="text-xs text-stone-500">until {formatTime(l.check_in_end_time)}</div>}
                    </Section>
                    <Section>
                        <Label icon={<LogOut className="h-3.5 w-3.5" />} text="Checkout" />
                        <div className="mt-1 text-base font-semibold text-stone-900">
                            {formatTime(l.check_out_time) ? 'by ' + formatTime(l.check_out_time) : '—'}
                        </div>
                    </Section>
                </div>

                {/* Parking + wifi, only if the host said */}
                {(a.parking_info || a.wifi_name) && (
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {a.parking_info && (
                            <Section>
                                <Label icon={<Car className="h-3.5 w-3.5" />} text="Parking" />
                                <p className="mt-1 whitespace-pre-line text-sm text-stone-700">{a.parking_info}</p>
                            </Section>
                        )}
                        {a.wifi_name && (
                            <Section>
                                <Label icon={<Wifi className="h-3.5 w-3.5" />} text="Wifi" />
                                <div className="mt-1 text-sm text-stone-700">{a.wifi_name}</div>
                                {a.wifi_password && (
                                    <div className="mt-1.5 flex items-center gap-2">
                                        <span className="font-mono text-sm text-stone-800">{a.wifi_password}</span>
                                        <CopyField value={a.wifi_password} label="Copy" />
                                    </div>
                                )}
                            </Section>
                        )}
                    </div>
                )}

                {/* Need a hand — the moment you're stuck outside */}
                <Section>
                    <Label icon={<Phone className="h-3.5 w-3.5" />} text={`Need a hand? Ask ${hostName}`} />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                        {hostPhone ? (
                            <a href={'tel:' + hostPhone} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800">
                                <Phone className="h-4 w-4" /> Call
                            </a>
                        ) : <span />}
                        <Link href={`/messages?b=${booking.id}`} className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm font-semibold text-stone-700 transition hover:border-stone-400">
                            <MessageCircle className="h-4 w-4" /> Message
                        </Link>
                    </div>
                </Section>

                <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-stone-400">
                    <CloudOff className="h-3.5 w-3.5" /> Signal’s patchy out here — open this before you set off and it stays put.
                </p>
            </div>
        </div>
    );
}
