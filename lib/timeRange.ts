// "10:00–12:00" — a session's start and end in the 24-hour clock, the way
// Airbnb's "Select a time" sheet lists them. Pure, so it can be tested.

function hm(total: number): string {
    const m = ((total % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/** "10:00" from "10:00" / "10:00:00"; with a length, "10:00–12:00". A bad start reads as given. */
export function timeRange24(start: string, minutes?: number | null): string {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(start || ''));
    if (!match) return String(start || '');
    const from = Number(match[1]) * 60 + Number(match[2]);
    const len = Number(minutes);
    return Number.isFinite(len) && len > 0 ? hm(from) + '–' + hm(from + len) : hm(from);
}
