import { openSecret, type SecretPlace } from './secretBox';
import { tokeniseSecrets } from './messageSecrets';

// Converts check-in messages already sent — stored with the door code (and
// any wifi password a host typed into a template) written in — to the
// placeholder form the sender now writes (lib/messageSecrets). Run by
// /api/cron/seal-listing-secrets inside Vercel, where the key is: the codes
// have to be opened to be found.
//
// Which messages: every one the system sent (automated = true), and the
// check-in sends from before that flag existed — a host-side message on the
// booking within two minutes of a check-in send the scheduler recorded. Those
// are flagged automated as they are converted, which is what they were. A
// message a person typed is never touched. Counts only; never a value.

const CHECKIN_TYPES = ['checkin_details', 'checkin_fallback'];

async function all(admin: any, table: string, cols: string, filter: (q: any) => any): Promise<any[]> {
    const out: any[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await filter(admin.from(table).select(cols)).order('id').range(from, from + 999);
        if (error) throw new Error(`${table}: ${error.message}`);
        out.push(...(data || []));
        if (!data || data.length < 1000) return out;
    }
}

function open(stored: string | null | undefined, place: SecretPlace): string | null {
    try { return openSecret(stored, place); } catch { return null; }
}

export async function tokeniseCheckinMessages(admin: any) {
    const tally = { scanned: 0, tokenised: 0, legacyFlagged: 0, changedUnderUs: 0 };

    const automated = await all(admin, 'messages', 'id, booking_id, sender_id, body, created_at, automated', (q) => q.eq('automated', true).not('booking_id', 'is', null));
    const sends = await all(admin, 'sent_scheduled_messages', 'id, booking_id, sent_at', (q) => q.in('template_type', CHECKIN_TYPES));
    const sendBookings = Array.from(new Set(sends.map((s) => s.booking_id)));
    const legacy: any[] = [];
    for (let i = 0; i < sendBookings.length; i += 200) {
        const ids = sendBookings.slice(i, i + 200);
        legacy.push(...await all(admin, 'messages', 'id, booking_id, sender_id, body, created_at, automated', (q) => q.in('booking_id', ids).eq('automated', false)));
    }
    const bookingIds = Array.from(new Set([...automated, ...legacy].map((m) => m.booking_id)));
    if (!bookingIds.length) return tally;

    const bookings: Record<string, any> = {};
    for (let i = 0; i < bookingIds.length; i += 200) {
        const { data } = await admin.from('bookings').select('id, listing_id, host_id').in('id', bookingIds.slice(i, i + 200));
        for (const b of data || []) bookings[b.id] = b;
    }
    const sendTimes: Record<string, number[]> = {};
    for (const s of sends) (sendTimes[s.booking_id] ||= []).push(new Date(s.sent_at).getTime());
    const isLegacyCheckin = (m: any) => {
        const b = bookings[m.booking_id];
        if (!b || m.sender_id !== b.host_id) return false;
        const at = new Date(m.created_at).getTime();
        return (sendTimes[m.booking_id] || []).some((t) => Math.abs(t - at) < 120000);
    };
    const candidates = [...automated, ...legacy.filter(isLegacyCheckin)];

    const listingIds = Array.from(new Set(Object.values(bookings).map((b: any) => b.listing_id)));
    const codeOf: Record<string, string | null> = {}, wifiOf: Record<string, string | null> = {}, overrideOf: Record<string, string | null> = {};
    for (let i = 0; i < listingIds.length; i += 200) {
        const ids = listingIds.slice(i, i + 200);
        const { data: codes } = await admin.from('listing_access_codes').select('listing_id, code').in('listing_id', ids);
        for (const c of codes || []) codeOf[c.listing_id] = open(c.code, { table: 'listing_access_codes', id: c.listing_id });
        const { data: wifis } = await admin.from('listing_arrival').select('listing_id, wifi_password').in('listing_id', ids);
        for (const w of wifis || []) wifiOf[w.listing_id] = open(w.wifi_password, { table: 'listing_arrival', id: w.listing_id });
    }
    for (let i = 0; i < bookingIds.length; i += 200) {
        const { data: overrides } = await admin.from('booking_access_codes').select('booking_id, code').in('booking_id', bookingIds.slice(i, i + 200));
        for (const o of overrides || []) overrideOf[o.booking_id] = open(o.code, { table: 'booking_access_codes', id: o.booking_id });
    }

    for (const m of candidates) {
        tally.scanned++;
        const b = bookings[m.booking_id];
        if (!b) continue;
        const next = tokeniseSecrets(m.body, { codes: [overrideOf[m.booking_id], codeOf[b.listing_id]], wifi: wifiOf[b.listing_id] });
        if (next === m.body) continue;
        // Only if the body is still what we read.
        const { data, error } = await admin.from('messages').update({ body: next, automated: true }).eq('id', m.id).eq('body', m.body).select('id');
        if (error) throw new Error(`messages: ${error.message}`);
        if (data && data.length) { tally.tokenised++; if (!m.automated) tally.legacyFlagged++; } else tally.changedUnderUs++;
    }
    return tally;
}
