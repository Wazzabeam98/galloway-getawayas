// A length in minutes as everyone reads it: in minutes up to 90 ("45 min",
// "60 min", "90 min"), in hours from 2 hours ("2 hr", "2 hr 30 min"). One rule
// for the editor's counter, its card summaries, the diary and the public
// experience page, so a provider and a guest never read one length two ways.
// Anything between 90 and 120 (a 105-minute session) stays in minutes, since
// it's under 2 hours. Zero, negative or no length → '' (callers show nothing).
//
// Imports nothing: a lib run by a unit test must not use '@/'.
export function durationWords(minutes: number | null | undefined): string {
    const m = Math.round(Number(minutes) || 0);
    if (m <= 0) return '';
    if (m < 120) return `${m} min`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h} hr ${mm} min` : `${h} hr`;
}
