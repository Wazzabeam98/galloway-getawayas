// "1 bed", not "1 beds". The counts on a listing — guests, bedrooms, beds,
// bathrooms, nights — were each written as an unconditional plural, so every
// one-of-anything read wrong. One helper so a fix in one place is a fix
// everywhere, rather than a `> 1` copied to each call site (which also gets
// zero wrong: "0 bed").
//
// English regular plural is +s, which covers every count word this site shows.
// Pass an explicit plural only for a genuine irregular (person → people).
export function plural(n: number, singular: string, pluralForm?: string): string {
    const word = n === 1 ? singular : (pluralForm || `${singular}s`);
    return `${n} ${word}`;
}
