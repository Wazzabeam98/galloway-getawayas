// When a session is "filling up" — the only time a guest is told how many spots
// are left. Airbnb's experiences do this: a time with plenty of room just reads
// as available; "2 spots left" appears only once people have booked and few
// places remain. Showing "8 spots available" on an empty session (and "Only 8
// seats left" under the guest count) read as scarcity that wasn't there.
//
// Display only. What can actually be booked is optionAvailability in
// lib/serviceSlots.ts, which the book route claims through; this never changes it.

/** Some seats booked, some left, and few left: at most 3, and at most half the session. */
export function isFillingUp(capacity: unknown, taken: unknown): boolean {
    const cap = Math.max(0, Number(capacity) || 0);
    const booked = Math.max(0, Number(taken) || 0);
    const left = cap - booked;
    if (cap <= 0 || booked <= 0 || left <= 0) return false;
    return left <= Math.max(1, Math.min(3, Math.floor(cap / 2)));
}

/** "1 spot left" / "3 spots left". */
export function spotsLeftLabel(left: number): string {
    return `${left} spot${left === 1 ? '' : 's'} left`;
}
