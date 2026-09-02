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

// Upcoming until checkout: confirmed and not yet ended. `now` is an instant,
// matching the trips page's own check that a stay is over only once checkout
// has actually passed.
export function upcomingUntilCheckout(
    b: { status: string; check_out: string },
    now: Date,
): boolean {
    return b.status === 'confirmed' && new Date(b.check_out) >= now;
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
