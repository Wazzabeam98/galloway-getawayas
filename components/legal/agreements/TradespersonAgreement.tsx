import { COMPANY_SENTENCE } from '@/config/company';

// THE TRADESPERSON AGREEMENT — what a tradesperson accepts, on top of the Terms
// of Service, at the end of the trade sign-up (lib/agreements.ts, key
// 'tradesperson'). The ONE copy: /terms/tradespeople renders it, and so does
// the sign-up's modal.
//
// PLACEHOLDER. The full agreement is with the solicitor. Until it is back, this
// sets out only what the trade sign-up already asks a tradesperson to declare,
// under the headings the agreement will cover. Nothing here promises anything
// the site does not already do.
//
// To change the wording: replace this file's body, then move `version` and
// `lastUpdated` for 'tradesperson' in lib/agreements.ts. Every tradesperson is
// asked to accept the new version the next time they sign in.
export default function TradespersonAgreement() {
    return (
        <div className="text-slate-700 space-y-4">
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                Draft — the full agreement is being finalised. The headings below are what it will
                cover; the wording may change, and you will be asked to agree again when it does.
            </p>

            <h2 className="text-lg font-bold text-slate-900 pt-2">Who we are</h2>
            <p>Galloway Getaways is operated by {COMPANY_SENTENCE}.</p>

            <h2 className="text-lg font-bold text-slate-900 pt-2">What we do for you</h2>
            <p>
                We introduce hosts to local tradespeople for jobs at their properties. Any contract for
                the work is between you and the host. No money for the job passes through us — you
                quote, and the host pays you directly.
            </p>

            <h2 className="text-lg font-bold text-slate-900 pt-2">Your trade and registrations</h2>
            <p>
                You tell us your trade and, where your trade needs one, your registration number (for
                example Gas Safe, OFTEC or an electrical scheme). You confirm that what you declare is
                true and that you will keep it up to date.
            </p>

            <h2 className="text-lg font-bold text-slate-900 pt-2">Where you work and when</h2>
            <p>
                You tell us the areas you cover and whether you take emergency call-outs, scheduled
                work, or both, so hosts in those areas can find you.
            </p>

            <h2 className="text-lg font-bold text-slate-900 pt-2">How you charge</h2>
            <p>
                You tell us how you price a job — a quote, an hourly rate or a flat fee, and any
                call-out fee. The prices you show hosts must be the prices you charge.
            </p>

            <h2 className="text-lg font-bold text-slate-900 pt-2">Enquiries and jobs</h2>
            <p>
                You reply to enquiries through the site. The quality, safety and completion of the work
                are your responsibility, along with your own insurance and legal obligations.
            </p>

            <h2 className="text-lg font-bold text-slate-900 pt-2">Getting listed</h2>
            <p>
                We review every application before it appears to hosts. Our approval is not a warranty
                of your skills, qualifications or credentials.
            </p>

            <h2 className="text-lg font-bold text-slate-900 pt-2">Suspension and changes</h2>
            <p>
                We may suspend a listing that breaches these terms or puts people at risk. These terms
                are governed by the law of Scotland.
            </p>
        </div>
    );
}
