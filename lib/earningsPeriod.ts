// The period an Earnings page opens on, for a host and a provider alike: this
// calendar year — but never before the month the account was created, so
// someone who joined in October opens on October to December, not on nine
// empty months (Liam, 21 Oct 2026). From the January after they joined, it is
// the whole year. A from/to the viewer picked always wins; this is only the
// default. Day keys are YYYY-MM-DD, in UK time.

export function defaultEarningsPeriod(accountCreatedAt: string | null | undefined, todayKey: string): { from: string; to: string } {
    const year = String(todayKey).slice(0, 4);
    const yearStart = `${year}-01-01`;
    const created = String(accountCreatedAt || '').slice(0, 7);
    const monthStart = /^\d{4}-\d{2}$/.test(created) ? `${created}-01` : '';
    return {
        from: monthStart && monthStart > yearStart && monthStart <= todayKey ? monthStart : yearStart,
        to: `${year}-12-31`,
    };
}
