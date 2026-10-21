// "Upcoming" means two different things, and the difference is deliberate — so
// it lives here, named, instead of as two inline expressions that look like
// copies of one another. (They were: the dashboard nudge carried a comment
// claiming it used the trips page's test. It did not, and it should not.)
//
//   TRIPS PAGE — a stay is upcoming until it ENDS. The guest is still on it
//   right up to checkout, so their address, map and arrival screen stay in
//   front of them the whole time they are there. Window closes at check-OUT.
//
//   DASHBOARD NUDGE — the nudge asks the host to write arrival directions,
//   which is only worth doing BEFORE the guest arrives. Once they have checked
//   in the prompt is pointless. Window closes at check-IN.
//
// Same word, two windows, on purpose. Keep them apart.

import { londonDayKey, daysBetweenKeys } from './dayKey';
import { londonInstant, timingFor, usesLockboxCode } from './scheduledMessages';
import type { Template, BookingLike } from './scheduledMessages';

// Upcoming until checkout: confirmed and not yet ended. Compared on the London
// CALENDAR day, not on the instant — the guest is on the stay for the whole of
// checkout day, until they leave that morning. The old `new Date(check_out) >=
// now` treated the stay as over from the instant of check_out's UTC midnight,
// which under BST is 01:00 on checkout morning: the card would vanish while the
// guest was still in the cottage, possibly opening it to check the checkout time.
export function upcomingUntilCheckout(
    b: { status: string; check_out: string },
    now: Date,
): boolean {
    return b.status === 'confirmed' && londonDayKey(now) <= String(b.check_out).slice(0, 10);
}

// Upcoming until arrival: confirmed and not yet arrived. `todayKey` is a
// yyyy-mm-dd date key, so the whole of check-in day still counts as "before
// arrival" — the host can still add the details on the morning of.
export function upcomingUntilArrival(
    b: { status: string; check_in: string },
    todayKey: string,
): boolean {
    return b.status === 'confirmed' && String(b.check_in).slice(0, 10) >= todayKey;
}

// Whether the home-page card should surface this booking at all. A confirmed
// stay counts until it ENDS — the same instant as upcomingUntilCheckout, so the
// card and the trips page can never disagree about when a stay is over. A
// pending request counts as long as its dates have not already passed: it is
// still a request until then, and stale once the dates are gone.
//
// This exists so the card stops carrying its own definition. It used to filter
// on `check_out >= todayKey`, where todayKey was a LOCAL midnight run through
// toISOString — which slips a day west of UTC, so under BST a stay that checked
// out yesterday still passed the filter and rendered as "-3 days to go".
export function liveForGuestCard(
    b: { status: string; check_out: string },
    now: Date,
): boolean {
    if (b.status === 'confirmed') return upcomingUntilCheckout(b, now);
    // A pending request counts by the same calendar-day rule as a confirmed
    // stay — stale only once checkout day itself has passed.
    if (b.status === 'pending') return londonDayKey(now) <= String(b.check_out).slice(0, 10);
    return false;
}

// Where a stay sits relative to today, as a phase rather than a raw number of
// days — so no surface has to decide for itself what a negative count means.
// The four surfaces that count down to (or through) a stay all read this:
// the home card headline, the Getting-there pill, and anywhere else tempted to
// subtract two dates inline.
//
//   before   — check-in is two or more days off; `daysUntilCheckIn` says how many
//   tomorrow — check-in is the next day
//   today    — check-in is today
//   during   — they have arrived and not yet passed checkout day
//   over      — checkout day is behind them
//
// `daysUntilCheckIn` is whole calendar days from today to check-in and can be
// negative once the stay is under way; callers print it only for `before`,
// where it is always >= 2, so a negative number never reaches a screen.
export type StayPhase = 'before' | 'tomorrow' | 'today' | 'during' | 'over';

export interface StayCountdown {
    phase: StayPhase;
    daysUntilCheckIn: number;
}

export function stayCountdown(
    b: { check_in: string; check_out: string },
    now: Date,
): StayCountdown {
    const todayKey = londonDayKey(now);
    const checkInKey = String(b.check_in).slice(0, 10);
    const checkOutKey = String(b.check_out).slice(0, 10);

    const daysUntilCheckIn = daysBetweenKeys(todayKey, checkInKey);

    let phase: StayPhase;
    if (todayKey > checkOutKey) phase = 'over';
    else if (daysUntilCheckIn >= 2) phase = 'before';
    else if (daysUntilCheckIn === 1) phase = 'tomorrow';
    else if (daysUntilCheckIn === 0) phase = 'today';
    else phase = 'during';

    return { phase, daysUntilCheckIn };
}

// How long before check-in the way in (door code, wifi password) starts to
// show. This used to be one hard-coded number — three days for every listing,
// which nobody had actually agreed. It is now the HOST's choice, stored per
// listing beside the code (listing_access_codes.release_hours), because it is
// their security to set. 24 hours is the default a listing gets until the host
// says otherwise.
//
// Read by every surface that reveals the code — the arrival page, the trip
// card, the message thread and the scheduled check-in message — and the SAME
// number governs all of them, so the message and the card can never hand the
// code over at different moments.
export const DEFAULT_CODE_RELEASE_HOURS = 24;

// The database check allows up to 336 hours (two weeks); the floor is now 0,
// which means "at check-in time" — the code shows the moment the guest can get
// in, not before. Kept in step with the migration's constraint.
export const MAX_CODE_RELEASE_HOURS = 336;

// What the host can pick from as a one-tap preset. Hours throughout; the label
// is what they read. "At check-in time" (0) and a fully custom time are offered
// alongside these in the editor, but these five are the standard spread.
// (Airbnb reveals check-in instructions at a fixed 48 hours and does not let
// the host move it — see the PR notes. We let the host decide and default
// tighter, at 24, because a stranger's door code is theirs to time.)
export const CODE_RELEASE_CHOICES: { hours: number; label: string }[] = [
    { hours: 12,  label: '12 hours before check-in' },
    { hours: 24,  label: '24 hours before check-in' },
    { hours: 48,  label: '2 days before check-in' },
    { hours: 72,  label: '3 days before check-in' },
    { hours: 168, label: '1 week before check-in' },
];

// When the code is handed over, as a single value the gate reads. One of two
// shapes, never both:
//   releaseAtTime null  -> releaseHours before the check-in instant (0 = at it)
//   releaseAtTime 'HH:MM:SS' -> that clock time on the check-in DAY, and
//                               releaseHours is then ignored.
// This is what every reveal surface passes to arrivalSecretsWindowOpen, so the
// card, the message thread and the scheduled sender can never read the setting
// differently.
export interface CodeReleaseSetting {
    releaseHours: number;
    releaseAtTime: string | null;
}

// The one rule for the hours-before value, used by the browser AND the server
// route that saves it, so a value the UI would reject can never reach the
// database by another path. Now any whole number in [0, 336] — 0 is "at
// check-in time", and the host may type a custom number of hours, not only a
// preset. Anything non-finite or out of range falls back to the default rather
// than being stored as a surprise.
export function normaliseReleaseHours(value: unknown): number {
    // Absent is the default, not zero — Number(null) and Number('') are both 0,
    // which would silently turn a missing setting into "at check-in time".
    if (value === null || value === undefined || value === '') return DEFAULT_CODE_RELEASE_HOURS;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return DEFAULT_CODE_RELEASE_HOURS;
    if (n < 0 || n > MAX_CODE_RELEASE_HOURS) return DEFAULT_CODE_RELEASE_HOURS;
    return n;
}

// 'HH:MM' or 'HH:MM:SS' -> 'HH:MM:SS', or null when absent or not a real time.
// The same rule the browser applies and the save route re-applies, so a bad
// value never reaches the row and a stored null always means "use the hours".
export function normaliseReleaseAtTime(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0') + ':00';
}

// Build the setting from the two stored columns, applying both rules. When a
// valid release_at_time is present it wins and the hours are left at the
// default (unused), so a caller can never accidentally read a stale hours value
// alongside an absolute time.
export function normaliseReleaseSetting(hours: unknown, atTime: unknown): CodeReleaseSetting {
    const releaseAtTime = normaliseReleaseAtTime(atTime);
    return { releaseHours: normaliseReleaseHours(hours), releaseAtTime };
}

// Accept either a bare hours number (the old call shape, still used by tests and
// a couple of call sites) or a full setting, and return a normalised setting.
function asReleaseSetting(release: number | CodeReleaseSetting): CodeReleaseSetting {
    if (typeof release === 'number') return { releaseHours: normaliseReleaseHours(release), releaseAtTime: null };
    return normaliseReleaseSetting(release.releaseHours, release.releaseAtTime);
}

// The window as a guest-facing duration — "24 hours", "2 days", "a week" — for
// copy like "shows here {label} before you arrive". No "before check-in" here;
// the sentence that uses it supplies that. Only meaningful for a positive
// hours-before window; 0 and an absolute time are handled by
// codeRevealWhenPhrase.
export function releaseHoursLabel(hours: number): string {
    const h = normaliseReleaseHours(hours);
    if (h % 24 !== 0 || h < 24) return h + ' hours';
    const days = h / 24;
    if (days === 7) return 'a week';
    return days === 1 ? '24 hours' : days + ' days';
}

// 'HH:MM:SS' -> a plain 12-hour clock a guest reads: '8am', '8.30am', 'noon',
// 'midnight'. Mirrors lib/utils formatTime, inlined so this module stays free
// of cross-lib imports (it is loaded by tests that resolve no path aliases).
function clockLabel(time: string): string {
    const parts = String(time).split(':');
    const hour = Number(parts[0]);
    const minute = Number(parts[1] || 0);
    if (isNaN(hour) || isNaN(minute)) return '';
    if (hour === 0 && minute === 0) return 'midnight';
    if (hour === 12 && minute === 0) return 'noon';
    const suffix = hour < 12 ? 'am' : 'pm';
    let display = hour % 12;
    if (display === 0) display = 12;
    return minute === 0 ? display + suffix : display + '.' + String(minute).padStart(2, '0') + suffix;
}

// The trailing clause for "Your door code shows here ___." — one sentence that
// reads right for all three shapes the host can set, so the arrival screen and
// the trip card describe the reveal the same way the gate enforces it:
//   hours before -> "24 hours before you arrive"
//   at check-in  -> "when you check in"
//   at a time    -> "from 8am on the day you arrive"
export function codeRevealWhenPhrase(release: number | CodeReleaseSetting): string {
    const setting = asReleaseSetting(release);
    if (setting.releaseAtTime) {
        const label = clockLabel(setting.releaseAtTime);
        return label ? 'from ' + label + ' on the day you arrive' : 'on the day you arrive';
    }
    if (setting.releaseHours === 0) return 'when you check in';
    return releaseHoursLabel(setting.releaseHours) + ' before you arrive';
}

// 'HH:MM:SS' -> the hour, defaulting to a 3pm check-in the way the rest of the
// site does when a listing has set no time.
function checkInHour(time: string | null | undefined): number {
    if (!time) return 15;
    const h = parseInt(String(time).split(':')[0], 10);
    return isNaN(h) || h < 0 || h > 23 ? 15 : h;
}

// Is the way in showable now? From `releaseHours` before the check-in INSTANT
// (the check-in time on check-in day, in UK local time) until the end of
// checkout day, and not after: a code that stays on a former guest's screen for
// ever is a key to the cottage they no longer need. This is the TIME half only
// — callers must also pass bookingReleasesPrivateData (paid, confirmed), which
// is the half that stops an unpaid planted row using it.
//
// `releaseHours` is the host's per-listing choice (default 24), and
// `checkInTime` is that listing's check-in time, so "24 hours before check-in"
// means 24 hours before when the guest can actually get in, not before some
// midnight.
export function arrivalSecretsWindowOpen(
    b: { check_in: string; check_out: string },
    now: Date,
    release: number | CodeReleaseSetting = DEFAULT_CODE_RELEASE_HOURS,
    checkInTime?: string | null,
): boolean {
    const { phase } = stayCountdown(b, now);
    if (phase === 'over') return false;
    const setting = asReleaseSetting(release);
    const checkInKey = String(b.check_in).slice(0, 10);

    let openFrom: number;
    if (setting.releaseAtTime) {
        // An absolute clock time on the check-in day, whatever the check-in
        // time is. The host chose this instant outright.
        const parts = setting.releaseAtTime.split(':');
        openFrom = londonInstant(checkInKey, Number(parts[0]), Number(parts[1])).getTime();
    } else {
        // `releaseHours` before the check-in instant (0 = exactly at it).
        openFrom = londonInstant(checkInKey, checkInHour(checkInTime)).getTime()
            - setting.releaseHours * 3_600_000;
    }
    return now.getTime() >= openFrom;
}

// Would a scheduled message carrying {lockbox_code} be held back because it is
// timed to send BEFORE the code is released? Returns the listings (by the title
// passed in) for which it would — empty when the message sends inside the
// window everywhere it applies. The editor warns from this; it reuses the exact
// gate and timing the cron sender uses, against a synthetic stay, so the
// warning and the actual hold can never disagree.
//
// A booking-anchored message is judged against a representative advance
// acceptance (a month before the stay), which is the normal case and the one
// where holding bites; a last-minute acceptance inside the window would not be
// held, but the hold is harmless either way (the message simply sends the
// moment the code is live), so erring towards the heads-up is right.
export function templateCodeHeldFor(
    template: Pick<Template, 'anchor' | 'days_offset' | 'send_hour' | 'minutes_after' | 'hours_after' | 'hours_before' | 'body'>,
    listings: { title?: string | null; release_hours?: number | null; release_at_time?: string | null; check_in_time?: string | null; check_out_time?: string | null }[],
): string[] {
    // A fixed future stay, far from today, so "now" never falls inside it.
    const CHECK_IN = '2099-06-15';
    const synthetic: BookingLike = {
        id: 'synthetic', host_id: '', guest_id: '', listing_id: '',
        check_in: CHECK_IN, check_out: '2099-06-18', status: 'confirmed',
        // A month before check-in: a booking-anchored message then lands well
        // before any release window.
        confirmed_at: '2099-05-15T09:00:00.000Z',
    };
    const tpl: Template = {
        user_id: '', template_type: '', enabled: true, listing_ids: null,
        anchor: template.anchor || 'none',
        days_offset: template.days_offset || 0,
        send_hour: typeof template.send_hour === 'number' ? template.send_hour : 9,
        minutes_after: template.minutes_after || 0,
        hours_after: template.hours_after || 0,
        hours_before: template.hours_before || 0,
        body: template.body || '',
    };

    // A template that does not ask for the code can never be held for the code.
    if (!usesLockboxCode(tpl.body)) return [];

    const held: string[] = [];
    for (const l of listings) {
        const timing = timingFor(tpl, synthetic, { check_in_time: l.check_in_time, check_out_time: l.check_out_time });
        if (!timing) continue;
        const open = arrivalSecretsWindowOpen(
            synthetic,
            timing.dueAt,
            normaliseReleaseSetting(l.release_hours ?? DEFAULT_CODE_RELEASE_HOURS, l.release_at_time ?? null),
            l.check_in_time,
        );
        if (!open) held.push(l.title || 'a property');
    }
    return held;
}
