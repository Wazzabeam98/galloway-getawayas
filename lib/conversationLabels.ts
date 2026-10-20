// The words under a name in the Messages list — what the conversation is
// about and where it has got to, the way Airbnb's inbox writes it:
// "Currently hosting · 19–22 Oct", "Confirmed · 19–22 Dec", "Cancelled",
// "Past". Worked out once, on the server, so the phone and desktop lists can
// never word the same booking two ways.

// Which filter tab a conversation sits under. Named after what the thread is
// ABOUT, not who it is with: a holiday-let booking, an experience order, a
// trade job.
export type ConversationCategory = 'homes' | 'experiences' | 'services';

export function categoryOf(kind: string): ConversationCategory {
    if (kind === 'order') return 'experiences';
    if (kind === 'enquiry') return 'services';
    return 'homes';
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(key: string): [number, number, number] | null {
    const [y, m, d] = String(key || '').slice(0, 10).split('-').map(Number);
    return y && m && d ? [y, m, d] : null;
}

// One day as "19 Oct" — the year only when it is not this year.
export function shortDay(key: string | null | undefined, todayKey: string): string {
    const p = parts(key || '');
    const t = parts(todayKey);
    if (!p) return '';
    return p[2] + ' ' + SHORT_MONTHS[p[1] - 1] + (t && t[0] !== p[0] ? ' ' + p[0] : '');
}

// A stay as Airbnb's inbox writes it: "19–22 Oct", "30 Oct – 2 Nov", and with
// the years once it leaves this one: "30 Dec 2026 – 2 Jan 2027". Built from the
// parts of the day keys (never a Date), so it can't slip a day in summer time.
export function shortDayRange(fromKey: string | null | undefined, toKey: string | null | undefined, todayKey: string): string {
    const a = parts(fromKey || '');
    const b = parts(toKey || '');
    if (!a) return '';
    if (!b) return shortDay(fromKey, todayKey);
    const t = parts(todayKey);
    const showYear = !t || a[0] !== t[0] || b[0] !== t[0];
    if (a[0] !== b[0]) {
        return a[2] + ' ' + SHORT_MONTHS[a[1] - 1] + ' ' + a[0] + ' – ' + b[2] + ' ' + SHORT_MONTHS[b[1] - 1] + ' ' + b[0];
    }
    const year = showYear ? ' ' + a[0] : '';
    if (a[1] === b[1]) {
        if (a[2] === b[2]) return a[2] + ' ' + SHORT_MONTHS[a[1] - 1] + year;
        return a[2] + '–' + b[2] + ' ' + SHORT_MONTHS[a[1] - 1] + year;
    }
    return a[2] + ' ' + SHORT_MONTHS[a[1] - 1] + ' – ' + b[2] + ' ' + SHORT_MONTHS[b[1] - 1] + year;
}

function withDates(word: string, dates: string): string {
    return dates ? word + ' · ' + dates : word;
}

// A holiday-let booking. The guest's own copy says "Currently staying" where
// the host's says "Currently hosting" — the same moment, seen from each side.
export function bookingStatusLine(b: {
    status: string | null | undefined;
    checkIn: string | null | undefined;
    checkOut: string | null | undefined;
    todayKey: string;
    viewerIsGuest: boolean;
}): string {
    const dates = shortDayRange(b.checkIn, b.checkOut, b.todayKey);
    const s = String(b.status || '');
    if (s === 'cancelled') return 'Cancelled';
    if (s === 'declined') return 'Declined';
    if (s === 'expired') return 'Expired';
    // A request nobody answered before the stay began has lapsed.
    if (s === 'pending') {
        return String(b.checkIn || '').slice(0, 10) <= b.todayKey ? 'Expired' : withDates('Request pending', dates);
    }
    if (s === 'holding' || s === 'pending_payment') return withDates('Not booked yet', dates);

    const inKey = String(b.checkIn || '').slice(0, 10);
    const outKey = String(b.checkOut || '').slice(0, 10);
    if (outKey && outKey <= b.todayKey) return 'Past';
    if (inKey && inKey <= b.todayKey) {
        return withDates(b.viewerIsGuest ? 'Currently staying' : 'Currently hosting', dates);
    }
    return withDates('Confirmed', dates);
}

// An experience order: one day. 'authorised' is paid and waiting on the
// provider's yes (see lib/changeRequest.ts), which Airbnb words as a request.
export function orderStatusLine(o: {
    status: string | null | undefined;
    serviceDate: string | null | undefined;
    todayKey: string;
}): string {
    const s = String(o.status || '');
    if (s === 'cancelled' || s === 'refunded') return 'Cancelled';
    if (s === 'declined') return 'Declined';
    const day = String(o.serviceDate || '').slice(0, 10);
    if (day && day < o.todayKey) return 'Past';
    const date = shortDay(day, o.todayKey);
    if (s === 'authorised') return withDates('Request pending', date);
    if (day && day === o.todayKey) return withDates('Today', date);
    return withDates('Confirmed', date);
}

// A trade job. Only accepted and cancelled jobs carry a thread at all.
export function enquiryStatusLine(e: {
    status: string | null | undefined;
    date: string | null | undefined;
    todayKey: string;
}): string {
    const s = String(e.status || '');
    if (s === 'cancelled') return 'Cancelled';
    const day = String(e.date || '').slice(0, 10);
    if (day && day < e.todayKey) return 'Past';
    return withDates('Confirmed', shortDay(day, e.todayKey));
}
