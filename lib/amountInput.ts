// What a money or number box in the listing editor holds, and what it saves.
//
// A box with nothing set is empty (with a light placeholder), never "0" — a 0
// left in the box is how "£0" typed over became "£030". As the host types,
// anything but digits (and one decimal point, for money) is dropped and a
// leading zero never survives in front of another digit.

export function cleanAmountInput(raw: string, decimals = true): string {
    let v = String(raw ?? '').replace(decimals ? /[^\d.]/g : /\D/g, '');
    if (decimals) {
        const dot = v.indexOf('.');
        // One point, at most two pence digits after it.
        if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 2);
        if (v.startsWith('.')) v = '0' + v;
    }
    return v.replace(/^0+(?=\d)/, '');
}

// A stored amount as the box first shows it: nothing set, or 0, is empty.
export function amountForBox(stored: string | number | null | undefined): string {
    if (stored === null || stored === undefined || stored === '') return '';
    const n = Number(stored);
    if (!Number.isFinite(n) || n === 0) return '';
    return cleanAmountInput(String(stored));
}

// What a box saves: a number, or null when it's empty, zero or not a number.
export function amountOrNull(v: string): number | null {
    const n = parseFloat(cleanAmountInput(v));
    return Number.isFinite(n) && n > 0 ? n : null;
}

// For a column that can't be empty (the fees are NOT NULL, default 0): an
// empty box saves as 0, which shows as an empty box again. Sending null there
// was refused by the database, so a fee could never be cleared.
export function amountOrZero(v: string): number {
    return amountOrNull(v) ?? 0;
}
