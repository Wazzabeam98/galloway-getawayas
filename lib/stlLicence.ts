// The Scottish short-term let licence on a listing — stl_licence_status,
// stl_licence_number, stl_licence_expiry. Edited in the listing editor's
// Pricing and booking tab, shown on the public listing page (the law wants the
// number on any advert). Framework-free so the editor and the page share it.

export const LICENCE_STATUSES: { key: string; label: string }[] = [
    { key: 'none', label: 'Not provided' },
    { key: 'licensed', label: 'Licensed' },
    { key: 'applied', label: 'Application submitted' },
    { key: 'exempt', label: 'Exempt' },
];

export function licenceStatusLabel(status: string | null | undefined): string {
    const found = LICENCE_STATUSES.filter((s) => s.key === (status || 'none'))[0];
    return found ? found.label : 'Not provided';
}

// Scottish numbers are usually three letters then five digits — a hint, not a
// rule: a council that issues another shape must not stop a host saving.
export function looksLikeLicenceNumber(number: string): boolean {
    return /^[A-Z]{3}[0-9]{5}$/.test(number);
}

// The one amber line under the licence fields, or null when all is well.
// `todayMs` is passed in so the page can render it on the server too.
export function licenceWarning(
    l: { stl_licence_status: string | null; stl_licence_number: string | null; stl_licence_expiry: string | null },
    todayMs: number = Date.now()
): string | null {
    const status = l.stl_licence_status || 'none';
    const number = (l.stl_licence_number || '').trim();

    if (status === 'none') {
        return 'No licence details yet. Short-term lets in Scotland need a licence, and the number has to appear on the listing.';
    }
    if (status === 'licensed' && !number) {
        return 'Add your licence number — it has to be shown on the listing.';
    }
    if (status === 'licensed' && !looksLikeLicenceNumber(number)) {
        return 'Scottish licence numbers are usually three letters followed by five digits, like ABC12345. Worth double-checking this one.';
    }
    if (l.stl_licence_expiry) {
        const days = Math.round((new Date(l.stl_licence_expiry).getTime() - todayMs) / 86400000);
        if (days < 0) return 'This licence has expired. Renew it before taking further bookings.';
        if (days < 60) return `This licence expires in ${days} days. Renewals can take a while — worth starting now.`;
    }
    return null;
}

// What the listing page prints, or null for nothing: the number once there is
// one (Airbnb's "Licence number" line), and "Exempt" when the host says so.
export function publicLicenceLine(status: string | null | undefined, number: string | null | undefined): string | null {
    const n = (number || '').trim();
    if (n) return 'Licence number: ' + n;
    if (status === 'exempt') return 'Exempt from short-term let licensing';
    return null;
}
