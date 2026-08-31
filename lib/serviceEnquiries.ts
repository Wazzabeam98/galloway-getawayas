// What an enquiry is, what state it can be in, and what each side is told.
//
// Same shape as lib/serviceProviders.ts and lib/listingRules.ts: pure
// functions and constants, no queries, so the shop, the enquiry form, the
// reply route and the expiry sweep all read the same rules and can be tested
// without a database anywhere near it.
//
// THERE IS NO MONEY IN HERE, AND THAT IS THE POINT
//
// Every trade that reaches this flow is on the subscription. The platform
// takes nothing per job, the work is paid off-platform, and so there is no
// total, no commission, no charge at acceptance and no refund. What the
// platform sells is the introduction. If a trade that pays commission is ever
// pointed at this file, the missing total is not a gap to fill in here — it
// means that trade wants a booking instead.

import {
    capabilityFor,
    extraByKey,
    calloutLine,
    pricingModelFor,
    canBeEnquiredAbout,
} from '@/lib/serviceProviders';

// ---------------------------------------------------------------------------
// STATES
// ---------------------------------------------------------------------------
//
//                        ┌─ accepted   contact details go both ways
//   sent ──▶ viewed ─────┼─ declined   with a reason, if he gave one
//     │        │         └─ (silence)
//     │        │              │
//     │        └──────────────┴──▶ expired    the sweep, whatever the urgency
//     └───────────────────────────▶ withdrawn  host pulled it first
//
// `viewed` earns its place because it is the only thing separating "ignored"
// from "never seen", and those need different words on the host's screen and
// different conversations at renewal.
//
// ONE ENDING FOR SILENCE, AND ONE WAY TO A PHONE NUMBER
//
// There was briefly a second: an emergency nobody answered released the
// tradesman's number automatically. It is gone, and it is not coming back
// quietly — see the note above URGENCY_LEVELS.
//
// There is deliberately no 'completed'. Nothing on the platform can observe a
// job being done — see `outcome` on the table.

export const ENQUIRY_STATUSES = [
    'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn',
] as const;

export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

// Still waiting on the tradesman. The only two states the expiry sweep touches
// and the only two the one-open-enquiry index counts.
export const OPEN_STATUSES: EnquiryStatus[] = ['sent', 'viewed'];

export function isOpen(status: string): boolean {
    return (OPEN_STATUSES as string[]).indexOf(String(status || '')) !== -1;
}

// Whether the two sides now have each other's details.
//
// One function, because three screens and two emails ask this question and
// three answers is how they come to disagree about whether a phone number is
// on the page.
// AN ACCEPT IS THE ONLY WAY TO A PHONE NUMBER. There is no second route and
// there must not be one. If this ever returns true for a second status, the
// thing the platform sells has been given away by whatever added it.
export function contactReleased(status: string): boolean {
    return String(status || '') === 'accepted';
}

export function canWithdraw(status: string): boolean {
    return isOpen(status);
}

// A reply link is spent once the enquiry has stopped waiting. An expired one
// included: a tradesman answering on the fourth day is answering a question
// the host has already taken elsewhere, and telling him it went through would
// be a lie that costs him a wasted journey.
export function canRespond(status: string): boolean {
    return isOpen(status);
}

// Calling off a job that was already accepted. Either side may, and only from
// 'accepted' — an open enquiry is withdrawn or declined, a finished one is
// finished. The route decides who is asking and words the alert accordingly.
export function canCancel(status: string): boolean {
    return String(status || '') === 'accepted';
}

// A cancelled enquiry is done. Re-asking is a fresh row, so the only thing to
// offer on this one is that re-ask — the same tradesman, a new request.
export function canReask(status: string): boolean {
    return String(status || '') === 'cancelled';
}

// ---------------------------------------------------------------------------
// URGENCY
// ---------------------------------------------------------------------------
//
// AN EMERGENCY IS STILL AN ENQUIRY, AND THAT IS A REVERSAL
//
// It was built handing the host the number on the spot. That was wrong, and
// the reason is not about the host at all — it is about what the platform can
// prove. Every trade in this flow is free for ninety days and then twenty
// pounds a month, and the only argument for the twenty pounds is "you got five
// jobs out of us". An introduction nobody accepted is not evidence of
// anything. Hand the number over unasked and the accept never happens, and the
// record of the work quietly stops existing.
//
// So an emergency is sent, and waits — but it waits for MINUTES, not days, and
// silence releases the number instead of giving up on it.
//
// ---------------------------------------------------------------------------
// THERE IS NO SAFETY NET, AND THAT IS THE DECISION. READ THIS BEFORE ADDING
// ONE BACK.
// ---------------------------------------------------------------------------
//
// An emergency nobody answers ends exactly as an ordinary enquiry nobody
// answers: it expires, and the host is told to try somebody else. The platform
// hands over nothing. A host with a flood and no answer gets nothing from us
// and rings somebody themselves.
//
// That is uncomfortable and it is deliberate. It was built the other way twice
// — first releasing the number immediately, then releasing it after twenty
// minutes — and both versions manufacture something that cannot be sold. The
// whole argument at day ninety is "you got five jobs out of us", and the
// accept is the only event that evidences one. An introduction the platform
// gave away is not an introduction the platform can charge for, whether it
// gave it away at once or after a decent interval.
//
// It also removes a question nobody had a good answer to: a tradesman's number
// going to a stranger because he was slow to look at his phone, on the
// strength of a tick box he filled in weeks earlier. Nothing is released, so
// nothing needs consenting to.
//
// WHAT AN EMERGENCY IS NOW: a shorter clock and a louder email. That is all,
// and it is enough — what it buys is a fast answer or a fast NO, either of
// which lets the host move on while it still matters.
//
// The thing to watch is the accept rate on emergencies. If tradesmen do not
// answer them quickly the product does not work, and the fix is making them
// see it sooner — a text rather than an email — not handing the number over.
//
// WHY TWENTY MINUTES
//
// It is how long a host is asked to wait before being told to try elsewhere.
// Short enough that somebody with water coming through a ceiling is not
// sitting still; long enough that a tradesman who glances at his phone between
// jobs has had a fair chance to answer. Five minutes would expire nearly every
// emergency before anybody saw it, which wastes the enquiry rather than
// speeding it up.
//
// The number to argue with once there are real ones to count is the ratio of
// accepted to expired on emergencies.
// ---------------------------------------------------------------------------

export const EMERGENCY_MINUTES = 20;

export const URGENCY_LEVELS = [
    {
        key: 'emergency',
        label: 'Emergency — something is happening now',
        // Says what it is for, and promises nothing about what happens next.
        // See the note above before adding anything here.
        hint: 'A leak, no power, no heat, a guest locked out. We put it in front of them straight away.',
        minutes: EMERGENCY_MINUTES,
    },
    {
        key: 'soon',
        label: 'Soon — in the next few days',
        hint: 'Broken, but nothing is being damaged while it waits.',
        minutes: 48 * 60,
    },
    {
        key: 'planned',
        label: 'Planned work',
        hint: 'A job to book in. Quotes, improvements, seasonal work.',
        minutes: 120 * 60,
    },
] as const;

export type Urgency = (typeof URGENCY_LEVELS)[number]['key'];

export function isUrgency(value: string): boolean {
    return URGENCY_LEVELS.some((u) => u.key === String(value || ''));
}

export function urgencyLabel(key: string): string {
    const found = URGENCY_LEVELS.filter((u) => u.key === key)[0];
    return found ? found.label : '';
}

export function isEmergency(urgency: string): boolean {
    return String(urgency || '') === 'emergency';
}

// When the tradesman stops being asked.
//
// Never null now — an emergency has the shortest deadline rather than none at
// all, which is the reversal in one line. The database says the same thing:
// see the expiry check constraint.
export function expiresAt(urgency: string, sentAt: Date | string): string {
    const found = URGENCY_LEVELS.filter((u) => u.key === String(urgency || ''))[0];
    const minutes = found ? found.minutes : 48 * 60;

    const base = typeof sentAt === 'string' ? new Date(sentAt) : sentAt;
    return new Date(base.getTime() + minutes * 60 * 1000).toISOString();
}

// Whether this one has run out of time.
//
// The whole of what silence means, now that there is only one ending. It used
// to be half of a pair with `dueOutcome`, which chose between expiring an
// ordinary enquiry and releasing a number on an emergency; there is no second
// ending to choose, so there is no chooser.
export function hasExpired(
    row: { status?: string; expires_at?: string | null },
    now?: Date
): boolean {
    if (!row || !isOpen(String(row.status || ''))) return false;
    if (!row.expires_at) return false;
    return new Date(row.expires_at).getTime() <= (now || new Date()).getTime();
}

// ---------------------------------------------------------------------------
// WHEN THE HOST WANTS SOMEBODY
// ---------------------------------------------------------------------------
//
// Planned work has a date and a window on it, because that is how a host
// actually thinks: somebody on the 3rd, between eleven and three, in the gap
// between one guest leaving and the next arriving. Asking for that as free
// text produces "sometime the week after next if that's ok?" and a phone call
// to pin down what a date field would have said.
//
// IT IS A REQUEST, AND EVERY WORD HAS TO SAY SO
//
// There is NO capacity model here. Nothing knows whether he is free on the
// 3rd, nothing holds the slot, and nothing stops the same window being asked
// for by four hosts. So this must never render as a booking:
//
//   * `requestedWhen` always begins "Asked for". Not "Booked for", not
//     "Confirmed", not a bare date sitting under a heading that could be read
//     as either.
//   * No calendar with days marked free or busy. A date input and two times.
//     A calendar is a promise about availability and there is nothing behind
//     it.
//   * The tradesman's email says what they ASKED for, and his accept means "I
//     will take a look", not "I am there at eleven on the 3rd". The two of
//     them settle the actual time between themselves, which is what happens
//     anyway.
//
// If a capacity model is ever built, this comment is the list of things that
// were deliberately not done, rather than things nobody thought of.

export const TIME_WINDOWS = [
    { key: 'any', label: 'Any time that day', from: null, to: null },
    { key: 'morning', label: 'Morning — 8am to 12', from: '08:00', to: '12:00' },
    { key: 'changeover', label: 'Changeover — 11am to 3pm', from: '11:00', to: '15:00' },
    { key: 'afternoon', label: 'Afternoon — 12 to 5pm', from: '12:00', to: '17:00' },
] as const;

export function windowByKey(key: string) {
    return TIME_WINDOWS.filter((w) => w.key === String(key || ''))[0] || null;
}

// Which urgencies carry a date. Only planned work: an emergency is happening
// now by definition, and "soon" is the answer of somebody who does not have a
// date in mind and should not be made to invent one.
export function needsDate(urgency: string): boolean {
    return String(urgency || '') === 'planned';
}

function prettyTime(value: string | null | undefined): string {
    const raw = String(value || '').slice(0, 5);
    if (!/^\d{2}:\d{2}$/.test(raw)) return '';

    const hour = Number(raw.slice(0, 2));
    const minute = raw.slice(3, 5);
    const suffix = hour < 12 ? 'am' : 'pm';
    const twelve = hour % 12 === 0 ? 12 : hour % 12;

    return minute === '00' ? twelve + suffix : twelve + '.' + minute + suffix;
}

// What the host asked for, in words, ALWAYS as a request.
//
// Returns null when there is nothing to say, so a caller renders no line
// rather than an empty one — "Asked for" with nothing after it reads like
// something failed to load.
export function requestedWhen(row: {
    preferred_date?: string | null;
    window_from?: string | null;
    window_to?: string | null;
}): string | null {
    if (!row || !row.preferred_date) return null;

    const date = new Date(String(row.preferred_date) + 'T12:00:00Z');
    if (isNaN(date.getTime())) return null;

    const when = date.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'Europe/London',
    });

    const from = prettyTime(row.window_from);
    const to = prettyTime(row.window_to);

    // "Asked for", every time. See the note above: this string ends up in an
    // email, on the host's list and on the tradesman's reply page, and it is
    // the only thing standing between a request and something that reads like
    // an appointment he agreed to.
    if (from && to) return 'Asked for ' + when + ', between ' + from + ' and ' + to;
    return 'Asked for ' + when + ', any time that day';
}

// ---------------------------------------------------------------------------
// WHO CAN BE ASKED
// ---------------------------------------------------------------------------

// Whether this provider can be handed to a host mid-emergency.
//
// A number to ring is the entire mechanism, so a provider without one cannot
// be offered however willing he is. The tick is his own: `*_out_of_hours` and
// `*_same_day` are availability toggles he set at sign-up, and being shown to
// a host at nine at night is what they mean.
export function offersEmergency(
    provider: any,
    offered: string[] | null | undefined
): boolean {
    if (!provider) return false;
    if (!String(provider.contact_phone || '').trim()) return false;

    const keys = (offered || []).map((k) => String(k));
    return keys.some((k) => k.indexOf('_out_of_hours') !== -1 || k.indexOf('_same_day') !== -1);
}

// The fault list a host ticks from — the same entries the tradesman ticked
// when he signed up, so "something keeps tripping" means one thing to both of
// them and the email needs no translation.
export function faultOptions(trade: string): Array<{ key: string; label: string }> {
    return capabilityFor(trade)
        .filter((e) => e.group === 'faults')
        .map((e) => ({ key: e.key, label: e.label }));
}

// What a host ticked, said in words, for the email and the screens.
export function faultLabels(keys: string[] | null | undefined): string[] {
    return (keys || [])
        .map((k) => extraByKey(String(k)))
        .filter((e): e is NonNullable<typeof e> => !!e)
        .map((e) => e.label);
}

// ---------------------------------------------------------------------------
// THE PRICE SNAPSHOT
// ---------------------------------------------------------------------------
//
// What the host was looking at when they pressed the button. Stored rather
// than joined, because a provider who puts his call-out up on Thursday must
// not retrospectively have quoted it on Tuesday.
//
// It is a display record and nothing multiplies it. There is no total to
// compute: the job is paid off-platform.

export interface PriceSnapshot {
    model?: string;
    callout_fee?: number | null;
    hourly_rate?: number | null;
    callout_waived?: boolean;
    band_key?: string | null;
    band_price?: number | null;
}

function num(value: any): number | null {
    const raw = String(value === null || value === undefined ? '' : value).trim();
    if (raw === '') return null;
    const n = Number(raw);
    return isFinite(n) && n > 0 ? n : null;
}

export function priceSnapshot(
    provider: any,
    bandKey?: string | null,
    bandPrice?: any
): PriceSnapshot {
    const trade = String((provider && provider.trade) || '');

    return {
        model: pricingModelFor(trade),
        callout_fee: num(provider && provider.callout_fee),
        hourly_rate: num(provider && provider.hourly_rate),
        callout_waived: !!(provider && provider.callout_waived),
        band_key: bandKey ? String(bandKey) : null,
        band_price: num(bandPrice),
    };
}

// The snapshot as a line a person reads. Null when the provider published
// nothing, which is an honest state for a roofer and must not render as "£0".
export function snapshotLine(snapshot: PriceSnapshot | null | undefined): string | null {
    if (!snapshot) return null;

    const parts: string[] = [];

    if (snapshot.band_price) {
        parts.push('£' + fmt(snapshot.band_price) + ' per visit');
    }

    const callout = calloutLine(snapshot.callout_fee ?? null, snapshot.callout_waived);
    if (callout) parts.push(callout);

    if (snapshot.hourly_rate) parts.push('£' + fmt(snapshot.hourly_rate) + ' an hour');

    return parts.length ? parts.join(' · ') : null;
}

function fmt(amount: number): string {
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

// ---------------------------------------------------------------------------
// THE REFERENCE
// ---------------------------------------------------------------------------
//
// Quotable on the phone. A tradesman ringing about "GG-7K2M" can start a
// conversation; one ringing about a uuid cannot.
//
// No I, O, 0 or 1 — this gets read aloud and written on the back of a hand.
// The random source is a parameter so a test can pin it, rather than the
// function reaching for Math.random and being untestable.
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function enquiryReference(random?: () => number): string {
    const rnd = random || Math.random;
    let out = '';
    for (let i = 0; i < 4; i++) {
        out += REFERENCE_ALPHABET.charAt(Math.floor(rnd() * REFERENCE_ALPHABET.length));
    }
    return 'GG-' + out;
}

// ---------------------------------------------------------------------------
// WHAT HAS TO BE FILLED IN
// ---------------------------------------------------------------------------

export interface Problem {
    field: string;
    message: string;
}

export interface EnquiryDraft {
    trade?: string | null;
    provider_id?: string | null;
    listing_id?: string | null;
    urgency?: string | null;
    summary?: string | null;
    fault_keys?: string[] | null;
    host_phone?: string | null;
    host_name?: string | null;
    preferred_date?: string | null;
    window_from?: string | null;
    window_to?: string | null;
}

// Short enough that a tradesman can read it on a phone, long enough to be
// worth reading. Ticked faults are not a substitute: "no hot water" and "no
// hot water since the tank was drained on Sunday" are different call-outs.
export const MIN_SUMMARY = 15;

export function enquiryProblems(draft: EnquiryDraft): Problem[] {
    const problems: Problem[] = [];
    const trade = String(draft.trade || '');

    if (!trade) {
        problems.push({ field: 'trade', message: 'Pick a trade.' });
    } else if (!canBeEnquiredAbout(trade)) {
        problems.push({ field: 'trade', message: 'That trade cannot be enquired about yet.' });
    }

    if (!String(draft.provider_id || '').trim()) {
        problems.push({ field: 'provider_id', message: 'Pick who to ask.' });
    }

    if (!isUrgency(String(draft.urgency || ''))) {
        problems.push({ field: 'urgency', message: 'Say how urgent it is.' });
    }

    // A TICKED CHIP IS AN ANSWER, SO THE BOX IS OPTIONAL ONCE THERE IS ONE.
    //
    // "Blocked toilet or shower" already says what is wrong, in the tradesman's
    // own vocabulary — it is the same list he ticked at sign-up. Demanding a
    // sentence on top of it asks somebody to write out what they have just
    // told us, and what they write to get past the form is worth less than the
    // chip.
    //
    // With nothing ticked the box is the only thing carrying the job, so it is
    // required. That is the rule: SOMETHING has to describe the work.
    const summary = String(draft.summary || '').trim();
    const ticked = (draft.fault_keys || []).filter((k) => String(k || '').trim() !== '');

    if (!ticked.length && summary.length < MIN_SUMMARY) {
        problems.push({
            field: 'summary',
            message: 'Tick what is wrong, or describe it in a sentence or two.',
        });
    }

    // A number, not an address. He is going to ring before he drives.
    if (!String(draft.host_phone || '').trim()) {
        problems.push({ field: 'host_phone', message: 'A phone number he can ring you on.' });
    }

    if (!String(draft.host_name || '').trim()) {
        problems.push({ field: 'host_name', message: 'Your name.' });
    }

    // Planned work carries a date. Not the other two: an emergency is
    // happening now, and somebody who picked "soon" is telling us they have no
    // date in mind — making them invent one produces a date nobody meant.
    if (needsDate(String(draft.urgency || ''))) {
        const date = String(draft.preferred_date || '').trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T12:00:00Z').getTime())) {
            problems.push({ field: 'preferred_date', message: 'Which day would you like them?' });
        }
    }

    // A window is optional — "any time that day" is a real answer and the
    // default. What is not allowed is a backwards one, which is a typo rather
    // than a preference and would be quoted back at the tradesman as nonsense.
    const from = String(draft.window_from || '').trim();
    const to = String(draft.window_to || '').trim();

    if (from && to && to <= from) {
        problems.push({ field: 'window_to', message: 'The window has to end after it starts.' });
    }
    if ((from && !to) || (to && !from)) {
        problems.push({ field: 'window_to', message: 'Give both ends of the window, or neither.' });
    }

    return problems;
}

export function canSend(draft: EnquiryDraft): boolean {
    return enquiryProblems(draft).length === 0;
}

// ---------------------------------------------------------------------------
// WHAT THE HOST IS TOLD
// ---------------------------------------------------------------------------
//
// The words a person reads, kept next to the values they come from so the two
// cannot drift — same as statusSummary in lib/serviceProviders.ts.
//
// Note what 'sent' and 'viewed' do NOT say. Neither promises anybody is
// coming. With one tradesman and no fan-out, silence is the likeliest way this
// fails, and a screen that says "on their way" while nothing has happened is
// how a host finds that out at the worst possible moment.

export function hostStatusSummary(
    status: string,
    businessName?: string | null,
    row?: { urgency?: string | null; expires_at?: string | null; cancelled_by?: string | null; cancel_reason?: string | null } | null
): { label: string; detail: string } {
    const who = String(businessName || 'They').trim() || 'They';

    // Called off after it was accepted. Worded from whichever side did it, and
    // the tradesman's reason is carried through so the host can decide what to
    // do — chase, or find someone else.
    if (status === 'cancelled') {
        // Trim the reason's own trailing full stop so we never print "…week..".
        const reason = String((row && row.cancel_reason) || '').trim().replace(/[.\s]+$/, '');
        if (row && row.cancelled_by === 'host') {
            return { label: 'Cancelled', detail: 'You cancelled this' + (reason ? ' — ' + reason + '.' : '.') };
        }
        return {
            label: 'Cancelled by them',
            detail: who + ' has cancelled'
                + (reason ? ' — ' + reason + '.' : '.')
                + ' You’ll need someone else for this one.',
        };
    }

    // A waiting emergency used to count down to the release. It does not any
    // more: the release is a safety net, not an offer, and a host who is told
    // to wait for a number learns to wait for a number. It says the enquiry is
    // urgent and with them, which is true, and stops there.
    const emergencyWait = row
        && isEmergency(String(row.urgency || ''))
        && isOpen(status);

    if (emergencyWait) {
        return {
            label: status === 'viewed' ? 'Opened' : 'Sent',
            detail: (status === 'viewed'
                ? who + ' has opened it and not answered yet.'
                : who + ' has been emailed and marked urgent.'),
        };
    }

    if (status === 'sent') {
        return {
            label: 'Sent',
            detail: who + ' has been emailed. Nobody has opened it yet.',
        };
    }
    if (status === 'viewed') {
        return {
            label: 'Opened',
            detail: who + ' has read it and not answered yet.',
        };
    }
    if (status === 'accepted') {
        return {
            label: 'Accepted',
            detail: who + ' will take a look. Their number is below — arrange it between you.',
        };
    }
    if (status === 'declined') {
        return {
            label: 'Not this one',
            detail: who + ' cannot take it on. Try somebody else who covers you.',
        };
    }
    if (status === 'expired') {
        return {
            label: 'No answer',
            detail: 'Nobody replied in time. Try somebody else who covers you.',
        };
    }
    if (status === 'withdrawn') {
        return { label: 'Withdrawn', detail: 'You took this back. Nothing was sent on.' };
    }

    return { label: 'Enquiry', detail: '' };
}

// A wall-clock time in the one time zone this site cares about. Vercel runs in
// UTC, which in summer is an hour behind Dumfries — enough to promise a host a
// number at half past two when it is half past three outside.
export function clockTime(value: string | null | undefined): string {
    if (!value) return 'shortly';

    const when = new Date(String(value));
    if (isNaN(when.getTime())) return 'shortly';

    return when.toLocaleTimeString('en-GB', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Europe/London',
    });
}

// How it went, asked afterwards and believed only as far as it deserves.
//
// Self-reported by whichever side answers, gating nothing and billed on
// nothing. That is exactly why it is safe to ask for: the day a number here
// decides what somebody pays, it stops being good enough.
export const OUTCOMES = [
    { key: 'went_ahead', label: 'They did the work' },
    { key: 'did_not', label: 'It did not go ahead' },
    { key: 'no_contact', label: 'We never actually spoke' },
] as const;

export function isOutcome(value: string): boolean {
    return OUTCOMES.some((o) => o.key === String(value || ''));
}

export function outcomeLabel(key: string): string {
    const found = OUTCOMES.filter((o) => o.key === key)[0];
    return found ? found.label : '';
}
