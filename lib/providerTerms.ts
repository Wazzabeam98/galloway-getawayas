// The provider terms shown on the finish screen of the guest-experience sign-up,
// and the version stamp recorded with every acceptance.
//
// SINGLE SOURCE. The finish screen renders exactly what is here; nothing else
// holds the terms text. Swapping in the reviewed version later is a change to
// THIS ONE FILE: replace `sections`, and bump `PROVIDER_TERMS_VERSION` so the
// stamp on every new acceptance reflects the text they actually agreed to.
//
// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER — NOT THE REAL TERMS, NOT FOR PRODUCTION.
//
// The real draft (TERMS-DRAFT-FOR-SOLICITOR.md, written in another session) is
// not in this clone. This stands in so the panel, the acceptance record and the
// gating can be built and reviewed. When the draft — or the solicitor's returned
// version — arrives, drop it in here and bump the version. The version slug
// carries the word "placeholder" on purpose: an acceptance stamped with it is
// obviously provisional.
// ─────────────────────────────────────────────────────────────────────────────

export const PROVIDER_TERMS_VERSION = 'placeholder-2026-09-09';

export interface TermsSection {
    heading: string;
    body: string[];
}

export interface ProviderTerms {
    version: string;
    title: string;
    // Shown at the top of the panel while the text is provisional. Empty once the
    // real terms are in and this notice is no longer true.
    draftNotice: string;
    sections: TermsSection[];
}

export const PROVIDER_TERMS: ProviderTerms = {
    version: PROVIDER_TERMS_VERSION,
    title: 'Provider terms and conditions',
    draftNotice:
        'PLACEHOLDER — this is draft wording standing in until the reviewed terms are ready. '
        + 'It is not legal advice and is not final.',
    sections: [
        {
            heading: '1. Who these terms are between',
            body: [
                '[Placeholder] These terms are between you, the provider of a guest experience, and '
                + 'Galloway Getaways Ltd, which runs the platform that introduces you to guests and '
                + 'collects payment on your behalf.',
                '[Placeholder] The contract for the experience itself is between you and the guest. '
                + 'We are not the provider of the experience and do not deliver it.',
            ],
        },
        {
            heading: '2. Your responsibilities',
            body: [
                '[Placeholder] You are responsible for holding your own public liability insurance, and '
                + 'for any permits, registrations and licences that apply to what you offer.',
                '[Placeholder] You are responsible for meeting the laws and safety requirements that '
                + 'apply to your experience, and for keeping what you tell guests accurate and current.',
            ],
        },
        {
            heading: '3. Payments and commission',
            body: [
                '[Placeholder] We collect the guest’s payment and pass it to you less our commission, '
                + 'on the terms set out when you set your prices.',
            ],
        },
        {
            heading: '4. Cancellations and changes',
            body: [
                '[Placeholder] How cancellations, refunds and changes are handled will be set out here '
                + 'in the reviewed terms.',
            ],
        },
        {
            heading: '5. Liability',
            body: [
                '[Placeholder] The allocation of liability between you, the guest and the platform will '
                + 'be set out here in the reviewed terms.',
            ],
        },
    ],
};
