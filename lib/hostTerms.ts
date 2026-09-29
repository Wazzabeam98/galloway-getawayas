// The host terms: what a holiday-let host agrees to, and the version stamp
// recorded when they do.
//
// As on Airbnb, the host terms ARE the site's Terms & Conditions — the one
// document at /terms (components/legal/TermsBody), which has its own "If you are
// a host" section. There is no second, host-only copy to drift from it.
//
// A host agrees by ticking "I agree to the terms and conditions" at the end of
// the listing flow. /api/listings/publish records HOST_TERMS_VERSION and the
// server's time on their profile (host_terms_version, host_terms_agreed_at),
// the same record the service-provider sign-up keeps in its declarations.
//
// BUMPING. When the /terms wording changes, move both constants below. Every
// host whose recorded version no longer matches is asked to agree again the
// next time they submit a listing — the same as Airbnb re-asking after its
// terms change.

export const TERMS_LAST_UPDATED = '28 September 2026';
export const HOST_TERMS_VERSION = '2026-09-28';

// Whether a host has agreed to the terms as they stand now.
export function hasAgreedToCurrentTerms(recordedVersion: string | null | undefined): boolean {
    return recordedVersion === HOST_TERMS_VERSION;
}

// What a submit must carry. A host already on the current version needs to
// send nothing; anybody else must send the version they were shown — and it
// must be the current one, so a stale page can't record an old agreement.
export function termsProblem(
    recordedVersion: string | null | undefined,
    submittedVersion: string | null | undefined,
): string | null {
    if (hasAgreedToCurrentTerms(recordedVersion)) return null;
    if (submittedVersion === HOST_TERMS_VERSION) return null;
    if (submittedVersion) {
        return 'The terms have been updated since this page loaded. Refresh the page, read them, and agree again to continue.';
    }
    return 'Please agree to the terms and conditions to continue.';
}
