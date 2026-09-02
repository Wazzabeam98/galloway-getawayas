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
