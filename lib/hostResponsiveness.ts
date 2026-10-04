// Response rate and typical response time for a host, worked out from real
// message history — the two trust lines Airbnb shows in "Meet your host".
//
// Every host STARTS in the good place and earns their way out of it, the way
// Airbnb does: response rate begins at 100% and typical time at "within a day".
// Neither line is ever hidden or blank, and neither is ever null. A brand-new
// host with no guests yet reads 100% / within a day, and the numbers only move
// once there is real history to move them.
//
// There is no stored aggregate for this, and a co-host is not a party on the
// booking row, so it is computed here with the SERVICE ROLE (the same reason the
// host block and co-host list on the listing page use adminClient).
//
// What counts, per booking thread (accommodation only — booking_id threads, not
// the service-marketplace enquiry/order ones):
//   - a thread "counts" once the guest has sent a message in it ("a message
//     received", in Airbnb's words — one inquiry to answer);
//   - it is "answered" if the host sent anything AFTER that first guest message
//     (so a host's automatic welcome message sent BEFORE the guest wrote doesn't
//     flatter the number);
//   - reply time = first host message after the first guest message, minus that
//     guest message.
// Response rate = answered / received, and 100% when nothing has been received —
// so it only ever DROPS below 100% when a guest's message went unanswered.
// Typical time = median reply time, defaulting to "within a day" until real
// replies build up.

type Admin = any;

export type HostResponsiveness = {
    responseRatePercent: number; // 0–100; starts at 100 and only drops on an unanswered guest message
    typicalLabel: string; // "within an hour" etc.; starts at "within a day"
    sampleSize: number; // how many guest-started threads this is based on
};

// Where every host starts, and where a host with no message history stays:
// a full response rate and Airbnb's middle "within a day" phrase.
const DEFAULT_TYPICAL = 'within a day';
const EMPTY: HostResponsiveness = { responseRatePercent: 100, typicalLabel: DEFAULT_TYPICAL, sampleSize: 0 };

// Minutes → the words Airbnb uses, and ONLY those four phrases — never an exact
// count of hours or minutes. Kept deliberately coarse: a median is not a
// promise, and "within an hour" reads as a habit rather than a stopwatch.
function labelForMinutes(mins: number): string {
    if (mins <= 60) return 'within an hour';
    if (mins <= 3 * 60) return 'within a few hours';
    if (mins <= 24 * 60) return 'within a day';
    return 'within a few days or more';
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function hostResponsiveness(admin: Admin, hostId: string): Promise<HostResponsiveness> {
    if (!hostId) return EMPTY;

    // The host's bookings — each one is a potential guest↔host thread. Capped:
    // a median and a rate are stable well before every booking a busy host has
    // ever had, and this runs on a page a stranger loads.
    const { data: bookings } = await admin
        .from('bookings')
        .select('id, guest_id, host_id')
        .eq('host_id', hostId)
        .order('created_at', { ascending: false })
        .limit(200);

    const guestByBooking = new Map<string, string>();
    for (const b of bookings || []) {
        if (b?.id && b?.guest_id) guestByBooking.set(b.id, b.guest_id);
    }
    if (guestByBooking.size === 0) return EMPTY;

    const bookingIds = Array.from(guestByBooking.keys());
    const { data: messages } = await admin
        .from('messages')
        .select('booking_id, sender_id, created_at')
        .in('booking_id', bookingIds)
        .order('created_at', { ascending: true });

    // Group messages by thread, already in time order from the query.
    const byThread = new Map<string, { sender: string; at: number }[]>();
    for (const m of messages || []) {
        if (!m?.booking_id) continue;
        const at = new Date(m.created_at).getTime();
        if (isNaN(at)) continue;
        if (!byThread.has(m.booking_id)) byThread.set(m.booking_id, []);
        byThread.get(m.booking_id)!.push({ sender: m.sender_id, at });
    }

    let counted = 0;
    let responded = 0;
    const replyMinutes: number[] = [];

    for (const [bookingId, guestId] of Array.from(guestByBooking.entries())) {
        const thread = byThread.get(bookingId);
        if (!thread || thread.length === 0) continue;

        const firstGuest = thread.find((m) => m.sender === guestId);
        if (!firstGuest) continue; // the guest never wrote — not a guest-started thread
        counted += 1;

        const hostReply = thread.find((m) => m.sender === hostId && m.at > firstGuest.at);
        if (hostReply) {
            responded += 1;
            replyMinutes.push((hostReply.at - firstGuest.at) / 60000);
        }
    }

    if (counted === 0) return EMPTY;

    return {
        responseRatePercent: Math.round((responded / counted) * 100),
        typicalLabel: replyMinutes.length ? labelForMinutes(median(replyMinutes)) : DEFAULT_TYPICAL,
        sampleSize: counted,
    };
}
