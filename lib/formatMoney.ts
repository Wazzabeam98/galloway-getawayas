// The one place a money amount becomes a string for a person to read.
//
// Amounts across this codebase are POUNDS as a number (e.g. total_price 480,
// price 180). They were rendered ad-hoc as '£' + n.toFixed(2), which never
// grouped thousands — "£10550.12" instead of "£10,550.12". Everything
// user-facing routes through here instead, so a five-figure payout reads the way
// money is written.
//
// Two shapes:
//   formatGBP(n)        -> "£10,550.12"   (the £ glyph; for JSX/plain text)
//   formatGBPAmount(n)  -> "10,550.12"    (no symbol; for HTML emails that emit
//                                          their own &pound; entity)

function toNumber(amount: number | string | null | undefined): number {
    const n = typeof amount === 'string' ? Number(amount) : Number(amount ?? 0);
    return Number.isFinite(n) ? n : 0;
}

const GROUPED = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

// "£10,550.12" — grouped thousands, always two decimals, negatives as "-£5.00".
export function formatGBP(amount: number | string | null | undefined): string {
    const n = toNumber(amount);
    const body = GROUPED.format(Math.abs(n));
    return (n < 0 ? '-£' : '£') + body;
}

// "10,550.12" — the same number without the £ glyph, for emails that already
// print a &pound; entity before the amount.
export function formatGBPAmount(amount: number | string | null | undefined): string {
    return GROUPED.format(toNumber(amount));
}

// "£2,040" / "£2,040.50" — grouped thousands, but pence only when the amount
// isn't a whole number of pounds. For the many places that show a price the way
// the site always has (a round nightly rate as "£2,040", a fee as "£12.50"),
// where forcing "£2,040.00" would change how every round price reads. Same
// grouping as formatGBP, so a price over £999 gets its comma everywhere.
export function formatPrice(amount: number | string | null | undefined): string {
    const n = toNumber(amount);
    const whole = Number.isInteger(n);
    const body = new Intl.NumberFormat('en-GB', {
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: 2,
    }).format(Math.abs(n));
    return (n < 0 ? '-£' : '£') + body;
}
