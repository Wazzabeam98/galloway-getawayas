import { PROVIDER_TERMS } from '@/lib/providerTerms';

// THE EXPERIENCE PROVIDER AGREEMENT — what a guest-experience provider accepts,
// on top of the Terms of Service, at the end of their sign-up (lib/agreements.ts,
// key 'experience_provider').
//
// The wording itself lives in lib/providerTerms.ts, where the sign-up has kept
// it since 07/09/2026 — that file stays the ONE copy. This only draws it.
//
// To change the wording: edit lib/providerTerms.ts, then move `version` and
// `lastUpdated` for 'experience_provider' in lib/agreements.ts (and
// PROVIDER_TERMS_VERSION to match).
export default function ExperienceProviderAgreement() {
    return (
        <div className="text-slate-700 space-y-4">
            {PROVIDER_TERMS.draftNotice && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    {PROVIDER_TERMS.draftNotice}
                </p>
            )}
            {PROVIDER_TERMS.sections.map((sec) => (
                <div key={sec.heading} className="space-y-2">
                    <h2 className="text-lg font-bold text-slate-900 pt-2">{sec.heading}</h2>
                    {sec.body.map((p, i) => <p key={i}>{p}</p>)}
                </div>
            ))}
        </div>
    );
}
