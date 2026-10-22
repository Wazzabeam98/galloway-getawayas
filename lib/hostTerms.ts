// The host terms — now one entry in the agreements registry (lib/agreements.ts).
//
// Kept as a thin wrapper so /api/listings/publish, /api/host/terms and their
// tests read exactly as before. The version and the rule live in the registry;
// change them there, not here.
//
// A host agrees by ticking the Host Agreement at the end of the listing flow.
// /api/listings/publish records the version and the server's time on their
// profile (host_terms_version, host_terms_agreed_at) and in
// agreement_acceptances.

import { AGREEMENTS, agreementProblem, hostAgreementCounts } from './agreements';
import { ukDate } from './dayKey';

export const HOST_TERMS_VERSION = AGREEMENTS.host.version;
export const TERMS_LAST_UPDATED = ukDate(AGREEMENTS.host.lastUpdated);

// Whether a host's agreement on record lets them submit without ticking again:
// the current version, or — while ASK_HOSTS_TO_REACCEPT_HOST_AGREEMENT is off —
// any earlier one (lib/agreements).
export function hasAgreedToCurrentTerms(recordedVersion: string | null | undefined): boolean {
    return hostAgreementCounts(recordedVersion);
}

// What a submit must carry — the shared rule, for the host document.
export function termsProblem(
    recordedVersion: string | null | undefined,
    submittedVersion: string | null | undefined,
): string | null {
    return agreementProblem('host', recordedVersion, submittedVersion);
}
