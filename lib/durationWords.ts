// A length in minutes as everyone reads it, the way Airbnb shows a duration:
// in minutes BELOW an hour ("30 min", "45 min"), and in hours and minutes from
// one hour up ("1 hr", "1 hr 30 min", "2 hr"). One rule for the editor's
// counter, its card summaries, the diary and the public experience page, so a
// provider and a guest never read one length two ways. Zero, negative or no
// length → '' (callers show nothing).
//
// Imports nothing: a lib run by a unit test must not use '@/'.
export function durationWords(minutes: number | null | undefined): string {
    const m = Math.round(Number(minutes) || 0);
    if (m <= 0) return '';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h} hr ${mm} min` : `${h} hr`;
}
