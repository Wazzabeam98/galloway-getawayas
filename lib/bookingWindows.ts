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
import { londonInstant } from './scheduledMessages';

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

// What the host can pick from. Hours throughout; the label is what they read.
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

// The one rule for a release window, used by the browser AND the server route
// that saves it, so a value the UI would reject can never reach the database by
// another path. Anything not on the list falls back to the default rather than
// being stored as a surprise.
export function normaliseReleaseHours(value: unknown): number {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return DEFAULT_CODE_RELEASE_HOURS;
    return CODE_RELEASE_CHOICES.some((c) => c.hours === n) ? n : DEFAULT_CODE_RELEASE_HOURS;
}

// The window as a guest-facing duration — "24 hours", "2 days", "a week" — for
// copy like "shows here {label} before you arrive". No "before check-in" here;
// the sentence that uses it supplies that.
export function releaseHoursLabel(hours: number): string {
    const h = normaliseReleaseHours(hours);
    if (h % 24 !== 0 || h < 24) return h + ' hours';
    const days = h / 24;
    if (days === 7) return 'a week';
    return days === 1 ? '24 hours' : days + ' days';
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
    releaseHours: number = DEFAULT_CODE_RELEASE_HOURS,
    checkInTime?: string | null,
): boolean {
    const { phase } = stayCountdown(b, now);
    if (phase === 'over') return false;
    const openFrom = londonInstant(String(b.check_in).slice(0, 10), checkInHour(checkInTime)).getTime()
        - normaliseReleaseHours(releaseHours) * 3_600_000;
    return now.getTime() >= openFrom;
}
