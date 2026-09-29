// The site's agreements — one registry, one set of rules.
//
// Structured the way Airbnb does it:
//
//   guest                 The Guest Terms, the general terms. EVERYONE accepts these when they
//                         make an account: the platform, your account, bookings,
//                         liability. /terms/guests.
//   host                  Accepted on top, once, when someone first submits a
//                         holiday-let listing. /terms/hosts.
//   experience_provider   Accepted on top at the end of the guest-experience
//                         sign-up. /terms/experience-providers.
//   tradesperson          Accepted on top at the end of the trade sign-up.
//                         /terms/tradespeople.
//
// Nobody is ever shown more than one of these at a time.
//
// SWAPPING THE WORDING (e.g. when the solicitor's version comes back) is two
// edits per document and nothing else:
//
//   1. the text, in the one file named by `textFile` below; and
//   2. `version` (and `lastUpdated`) for that document, here.
//
// (Wording lives in markdown inside a .ts file, rendered by
// components/legal/LegalMarkdown, so a new draft can be pasted straight in.)
//
// Every account whose recorded version no longer matches is asked to accept the
// new one the next time they sign in (components/legal/AgreementGate), and every
// server wall compares against this registry, so nothing else needs touching.
//
// Where an acceptance is recorded: public.agreement_acceptances (user, document,
// version, server time), written only by the server with the service role —
// /api/agreements for the general case, /api/listings/publish for a host's first
// submit (which also keeps profiles.host_terms_version, read by that route).
// The provider and trade sign-ups record through /api/agreements, and
// submit_service_provider() refuses a submit with no acceptance on record.
//
// Kept free of React and of '@/' imports so the unit tests can load it directly.

export type AgreementKey = 'guest' | 'host' | 'experience_provider' | 'tradesperson';

export interface Agreement {
    key: AgreementKey;
    // What the document is called, in the tick line and on its page.
    title: string;
    // Who it is for, one line — the /terms index and the sign-in prompt.
    audience: string;
    // Its own page. The tick line's underlined link opens this in a new tab.
    path: string;
    // The version stamp recorded with every acceptance. Change it whenever the
    // wording changes; that is what makes everyone accept again.
    version: string;
    // The day key the wording last changed (YYYY-MM-DD). Rendered DD/MM/YYYY.
    lastUpdated: string;
    // The one file that holds the wording, for whoever swaps it.
    textFile: string;
    // True while the text is a placeholder or has not been reviewed by the
    // solicitor. The page and the modal show a banner while it is.
    draft: boolean;
}

export const AGREEMENTS: Record<AgreementKey, Agreement> = {
    guest: {
        key: 'guest',
        title: 'Guest Terms',
        audience: 'Everyone with an account — guests, hosts, providers and tradespeople.',
        path: '/terms/guests',
        version: 'v1-draft-2026-09-29',
        lastUpdated: '2026-09-29',
        textFile: 'components/legal/agreements/text/guest.ts',
        draft: true,
    },
    host: {
        key: 'host',
        title: 'Host Agreement',
        audience: 'Hosts who list a holiday let.',
        path: '/terms/hosts',
        // Unchanged from lib/hostTerms' HOST_TERMS_VERSION: the host section was
        // moved out of /terms word for word, so a host who agreed on 28/09/2026
        // has agreed to exactly this and is not asked again.
        version: '2026-09-28',
        lastUpdated: '2026-09-28',
        textFile: 'components/legal/agreements/HostAgreement.tsx',
        draft: false,
    },
    experience_provider: {
        key: 'experience_provider',
        title: 'Experience Provider Agreement',
        audience: 'Local providers who offer guest experiences — a chef, a sauna, a cake, a photographer.',
        path: '/terms/experience-providers',
        // The v1 draft replaces the 07/09/2026 provider terms
        // (draft-2026-09-07), so a provider who agreed to those is asked again.
        version: 'v1-draft-2026-09-29',
        lastUpdated: '2026-09-29',
        textFile: 'components/legal/agreements/text/experience-provider.ts',
        draft: true,
    },
    tradesperson: {
        key: 'tradesperson',
        title: 'Tradesperson Agreement',
        audience: 'Tradespeople who take jobs from hosts — plumbers, electricians, joiners and the rest.',
        path: '/terms/tradespeople',
        version: 'v1-draft-2026-09-29',
        lastUpdated: '2026-09-29',
        textFile: 'components/legal/agreements/text/tradesperson.ts',
        draft: true,
    },
};

// The order they are asked in, when somebody owes more than one: the general
// terms first, then the role agreements.
export const AGREEMENT_ORDER: AgreementKey[] = ['guest', 'host', 'experience_provider', 'tradesperson'];

export function isAgreementKey(value: unknown): value is AgreementKey {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AGREEMENTS, value);
}

// Whether a recorded version is the one in force now.
export function hasAgreed(key: AgreementKey, recordedVersion: string | null | undefined): boolean {
    return !!recordedVersion && recordedVersion === AGREEMENTS[key].version;
}

// THE ONE RULE, shared by every tick box in the browser and every server wall.
//
// Somebody already on the current version needs to send nothing. Anybody else
// must send the version they were shown — and it must be the current one, so a
// page left open across a wording change cannot record the old text.
export function agreementProblem(
    key: AgreementKey,
    recordedVersion: string | null | undefined,
    submittedVersion: string | null | undefined,
): string | null {
    if (hasAgreed(key, recordedVersion)) return null;
    if (submittedVersion && submittedVersion === AGREEMENTS[key].version) return null;
    const title = AGREEMENTS[key].title;
    if (submittedVersion) {
        return `The ${title} was updated after this page loaded. Refresh the page, read it, and agree again to continue.`;
    }
    return `Please agree to the ${title} to continue.`;
}

// What the browser sends with a tick: the version it was shown, or nothing
// when the box was not ticked. One place, so every form sends the same shape.
export function versionForTick(key: AgreementKey, ticked: boolean): string | undefined {
    return ticked ? AGREEMENTS[key].version : undefined;
}

// Which role agreements an account owes, from what it is: a host with a listing
// submitted or live, a provider/tradesperson with an application sent or
// approved. A draft owes nothing yet — they accept at the end of the sign-up.
export interface RoleFacts {
    isHost: boolean;
    isExperienceProvider: boolean;
    isTradesperson: boolean;
}

export function requiredAgreements(roles: RoleFacts): AgreementKey[] {
    const out: AgreementKey[] = ['guest'];
    if (roles.isHost) out.push('host');
    if (roles.isExperienceProvider) out.push('experience_provider');
    if (roles.isTradesperson) out.push('tradesperson');
    return out;
}

// The ONE document the sign-in prompt should show next, or null when nothing
// is owed. `recorded` maps a document to every version this account has
// accepted (any one matching the current version counts).
export function nextOwed(
    roles: RoleFacts,
    recorded: Partial<Record<AgreementKey, string[]>>,
): AgreementKey | null {
    const owed = requiredAgreements(roles);
    for (const key of AGREEMENT_ORDER) {
        if (owed.indexOf(key) === -1) continue;
        const versions = recorded[key] || [];
        if (!versions.some((v) => hasAgreed(key, v))) return key;
    }
    return null;
}

// The version recorded for a document that counts as current, if any.
export function currentFrom(key: AgreementKey, versions: string[] | undefined): string | null {
    return (versions || []).filter((v) => hasAgreed(key, v))[0] || null;
}
