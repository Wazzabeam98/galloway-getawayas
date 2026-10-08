// Why a free night on the host calendar is marked "Short gap" — said in the
// panel when the host selects one, so the hatched night never reads as
// something they blocked.
//
// The rule itself is lib/stayRules (unsellableNights): a run of free nights
// shorter than the minimum stay can only be sold when it is boxed in on both
// sides by an unavailable night, so a guest can fill it exactly. A run that is
// open on one side — against the first night still open to guests, or the end
// of the booking window — has no stay that can include it. This file only
// finds the run around a night and puts that into words; it decides nothing.

import { addDaysKey, nightsBetweenKeys } from './stayRules';

export interface ShortGap {
    start: string;        // first free night of the run
    end: string;          // last free night of the run
    nights: number;
    minNights: number;    // the minimum for a stay checking in on `start`
    openAtStart: boolean; // nothing unavailable the night before
    openAtEnd: boolean;   // nothing unavailable the night after
}

// The short-gap run that contains `key`, or null when `key` is not one.
export function shortGapAt(
    key: string,
    unsellable: Set<string>,
    unavailable: Set<string>,
    minFor: (checkInKey: string) => number,
): ShortGap | null {
    if (!unsellable.has(key)) return null;
    let start = key;
    while (unsellable.has(addDaysKey(start, -1))) start = addDaysKey(start, -1);
    let end = key;
    while (unsellable.has(addDaysKey(end, 1))) end = addDaysKey(end, 1);
    return {
        start,
        end,
        nights: nightsBetweenKeys(start, end) + 1,
        minNights: minFor(start),
        openAtStart: !unavailable.has(addDaysKey(start, -1)),
        openAtEnd: !unavailable.has(addDaysKey(end, 1)),
    };
}

function nightsWord(n: number): string {
    return n + (n === 1 ? ' night' : ' nights');
}

// The panel's words for a short gap: a heading, why, and what fixes it.
export function shortGapWords(gap: ShortGap): { title: string; why: string; fix: string } {
    const these = gap.nights === 1 ? 'this night' : 'these ' + gap.nights + ' nights';
    const side = gap.openAtStart && gap.openAtEnd
        ? 'it has nothing booked or blocked on either side'
        : gap.openAtStart
            ? 'it starts at the first night guests can still book, so nothing is booked or blocked before it'
            : 'it runs up to the end of your booking window, so nothing is booked or blocked after it';
    return {
        title: gap.nights === 1 ? 'Nobody can book this night' : 'Nobody can book these nights',
        why: 'This is a gap of ' + nightsWord(gap.nights) + ', shorter than your '
            + gap.minNights + '-night minimum stay. A shorter stay is only allowed when it fills '
            + 'a gap exactly, between two booked or blocked nights — but ' + side + '.',
        fix: 'To sell ' + these + ', set the minimum stay for them to ' + nightsWord(gap.nights)
            + ' below. It isn’t something you blocked.',
    };
}
