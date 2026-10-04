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
// It measures THE HOST SIDE, not one person. The host side of a listing is the
// host plus everyone they've given active access to — their co-hosts and staff.
// A guest doesn't care who on that side wrote back, and neither does this: a
// co-host's reply answers the guest just as the host's would. (The first version
// counted only the host_id's own replies, so a listing whose messages are handled
// by a co-host — e.g. Jamie answering for Liam's townhouse — read 0%, every real
// reply invisible. That was the bug.)
//
// What counts, per booking thread (accommodation only — booking_id threads, not
// the service-marketplace enquiry/order ones):
//   - the booking must be a REAL guest's, not the host side's own: a booking
//     whose guest is the host or one of their co-hosts/staff (a test booking they
//     made on their own place) is skipped entirely;
//   - the thread must be GUEST-INITIATED — its first message is from that guest.
//     A thread that opens with a host-side message (an automated check-in send, a
//     host reaching out first) or where the guest is only replying is not an
//     inquiry that "needed a reply", so it isn't counted;
//   - it is "answered" only if a PERSON on the host side wrote after that first
//     guest message. An automated send — a scheduled template, a check-in
//     message, a canned notice — is flagged `automated` on the row and never
//     counts as a reply, the way Airbnb doesn't count its own auto-messages;
//   - reply time = first such human host-side message after the first guest
//     message, minus that guest message.
// Response rate = answered / received, and 100% when nothing real has been
// received — so it only ever DROPS below 100% when a real guest's opening message
// to the host side went unanswered by a person. Typical time = median reply time,
// defaulting to "within a day" until real replies build up.

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

    // The host's bookings — each one is a potential guest↔host-side thread.
    // Capped: a median and a rate are stable well before every booking a busy
    // host has ever had, and this runs on a page a stranger loads.
    const { data: bookings } = await admin
        .from('bookings')
        .select('id, guest_id, host_id, listing_id')
        .eq('host_id', hostId)
        .order('created_at', { ascending: false })
        .limit(200);

    if (!bookings || bookings.length === 0) return EMPTY;

    // The host side per listing = the host plus that listing's active co-hosts
    // and staff. A reply from any of them answers the guest; a booking whose
    // "guest" is one of them is a test booking on their own place, not a guest.
    const listingIds = Array.from(
        new Set((bookings as any[]).map((b) => b.listing_id).filter(Boolean)),
    );
    const teamByListing = new Map<string, Set<string>>();
    if (listingIds.length) {
        const { data: access } = await admin
            .from('listing_access')
            .select('listing_id, user_id, status')
            .in('listing_id', listingIds)
            .eq('status', 'active');
        for (const a of access || []) {
            if (!a?.user_id || !a?.listing_id) continue;
            if (!teamByListing.has(a.listing_id)) teamByListing.set(a.listing_id, new Set());
            teamByListing.get(a.listing_id)!.add(a.user_id);
        }
    }
    const hostSideFor = (listingId: string): Set<string> => {
        const side = new Set<string>([hostId]);
        const team = teamByListing.get(listingId);
        if (team) team.forEach((u) => side.add(u));
        return side;
    };

    // Keep only real guests' bookings — drop the host side's own/test bookings.
    const guestBookings = (bookings as any[]).filter(
        (b) => b?.id && b?.guest_id && !hostSideFor(b.listing_id).has(b.guest_id),
    );
    if (guestBookings.length === 0) return EMPTY;

    const bookingIds = guestBookings.map((b) => b.id);
    const { data: messages } = await admin
        .from('messages')
        .select('booking_id, sender_id, created_at, automated')
        .in('booking_id', bookingIds)
        .order('created_at', { ascending: true });

    // Group messages by thread, already in time order from the query. We keep
    // automated sends here, because an automated message BEFORE the guest wrote
    // still means the guest was only replying (not opening an inquiry); they just
    // never count as a reply (below).
    const byThread = new Map<string, { sender: string; at: number; automated: boolean }[]>();
    for (const m of messages || []) {
        if (!m?.booking_id) continue;
        const at = new Date(m.created_at).getTime();
        if (isNaN(at)) continue;
        if (!byThread.has(m.booking_id)) byThread.set(m.booking_id, []);
        byThread.get(m.booking_id)!.push({ sender: m.sender_id, at, automated: m.automated === true });
    }

    let counted = 0;
    let responded = 0;
    const replyMinutes: number[] = [];

    for (const b of guestBookings) {
        const thread = byThread.get(b.id);
        if (!thread || thread.length === 0) continue;

        // Guest-initiated only: the first message in the thread must be a real,
        // non-automated message from the guest. A thread that opens with a host-
        // side message (the guest is only replying), or with an automated system
        // notice — including the system-composed "guest updated the booking" and
        // cancel-request messages, which are sent AS the guest — is not an
        // inquiry that needed a personal reply.
        const first = thread[0];
        if (first.automated || first.sender !== b.guest_id) continue;
        counted += 1;

        // Only a PERSON's reply on the host side counts. An automated send — a
        // scheduled template, a check-in message, a canned notice — is not a
        // response, the way Airbnb doesn't count its own auto-messages.
        const hostSide = hostSideFor(b.listing_id);
        const reply = thread.find(
            (m) => m.at > first.at && m.sender !== b.guest_id && hostSide.has(m.sender) && !m.automated,
        );
        if (reply) {
            responded += 1;
            replyMinutes.push((reply.at - first.at) / 60000);
        }
    }

    if (counted === 0) return EMPTY;

    return {
        responseRatePercent: Math.round((responded / counted) * 100),
        typicalLabel: replyMinutes.length ? labelForMinutes(median(replyMinutes)) : DEFAULT_TYPICAL,
        sampleSize: counted,
    };
}
