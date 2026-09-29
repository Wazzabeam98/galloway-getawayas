// The wording of this agreement, exactly as drafted (~/Desktop/TRADESPERSON-AGREEMENT-DRAFT.md,
// 29/09/2026). THE ONE COPY — its page, the tick box's panel and the sign-in
// prompt all render this. To swap in the solicitor's wording: replace the text
// between the backticks with the new markdown, then move this document's
// `version` and `lastUpdated` in lib/agreements.ts.
//
// {{COMPANY_NUMBER}} and {{REGISTERED_OFFICE}} are filled in from
// config/company.ts when the text is drawn — the company details are written
// in that one place only (tests/company-details.test.ts). Otherwise the text
// is the draft word for word.

export const TRADESPERSON_AGREEMENT = String.raw`# Tradesperson Agreement

**Galloway Getaways Ltd** (company number {{COMPANY_NUMBER}}), registered office {{REGISTERED_OFFICE}} ("we", "us", "Galloway Getaways") and you, the trade business listing on the platform ("you", "the Tradesperson").

Version: v1-DRAFT — to be dated on approval.

---

## 1. What this agreement covers

We run a directory on our platform where property owners ("Owners") can find local trades. We list your business, show what you do and what you charge, and pass enquiries to you.

**We are an introduction service only.** We do not employ you, supervise you, take payment for your work, or take any part in the job you agree with an Owner.

## 2. Your contract is with the Owner

2.1 When an Owner enquires and you agree to do work, **the contract for that work is between you and the Owner.** We are not a party to it.

2.2 **We do not handle money for your work.** You invoice the Owner and they pay you directly. We take no commission on what you charge and we hold none of it.

2.3 Any call-out fee, hourly rate, flat fee or quote you show on the platform is between you and the Owner. We do not collect it, guarantee it, or chase it.

## 3. Your subscription

3.1 Listing costs the subscription fee shown when you sign up, currently £20 per month.

3.2 New Tradespeople get a free trial of six months from the date your listing goes live. The date your trial ends is shown in your dashboard.

3.3 After the trial, the fee is charged monthly in advance to the card you provide. If payment fails, we will tell you and may remove your listing until it is paid.

3.4 You may cancel at any time. Your listing stays up until the end of the period you have paid for. We do not refund part months.

3.5 We may change the fee on at least one month's notice. If you do not want to continue at the new price, cancel before it takes effect.

## 4. What you are responsible for

4.1 Doing the work competently, safely and to the standard a reasonable Owner would expect.

4.2 Holding every licence, registration, certification and qualification the law requires for your trade, and keeping them current. That includes, where relevant, Gas Safe registration and electrical competent person scheme membership.

4.3 Holding public liability insurance appropriate to your trade, and any other insurance the law or your trade body requires.

4.4 Your own tax, National Insurance and VAT. You are self-employed or a business in your own right.

4.5 Keeping your listing accurate: the services you cover, the areas you work in, your availability, and your prices.

4.6 Responding to enquiries promptly, and telling the Owner clearly if you cannot take a job.

## 5. We do not vet you

5.1 We may review your listing before it appears. **That review is not an endorsement, and is not a warranty as to your skills, quality, suitability, qualifications, credentials, registration or insurance.**

5.2 Where you give us a registration number, we display it so an Owner can check it themselves on the public register. **We do not verify it.**

5.3 It is for each Owner to satisfy themselves about you, including asking for proof of registration, qualifications and insurance before engaging you.

## 6. Your liability and indemnity

6.1 You are liable for your work, your acts and omissions, and any loss, injury or damage arising from them.

6.2 **You indemnify us** against all claims, losses, costs and expenses (including reasonable legal costs) arising from work you do for an Owner, your breach of this agreement, or your breach of any law.

## 7. Our liability

7.1 Nothing limits our liability for death or personal injury caused by our negligence, for fraud, or for anything else that cannot lawfully be limited.

7.2 Subject to 7.1, we are not liable to you for lost profit, lost business, or loss of opportunity, and our total liability to you in any twelve-month period is limited to the subscription fees you paid us in that period.

7.3 **We do not guarantee any enquiries, any work, or any income.** The subscription pays for the listing, not for results.

7.4 We are not responsible for an Owner's conduct, for their failure to pay you, or for any dispute between you.

## 8. Conduct

8.1 You will deal with Owners honestly and professionally.

8.2 You will not use contact details obtained through the platform for marketing unrelated to the enquiry.

8.3 We may suspend or remove your listing where you break this agreement, where an Owner raises a serious complaint, where your registration or insurance lapses, or where we reasonably suspect fraud.

## 9. Content and data

9.1 You keep ownership of the photographs and text you upload, and grant us a non-exclusive, royalty-free licence to use them to advertise your listing and promote the platform.

9.2 Each of us is a separate data controller for the personal data we hold. You will handle Owner data only for the enquiry and any resulting work, and in line with data protection law.

## 10. Ending this agreement

10.1 Either of us may end this agreement on notice. Your listing comes down at the end of the paid period.

10.2 We may end it immediately where you break it, where a required registration or insurance lapses, or where someone is put at risk.

10.3 Work you have already agreed with an Owner remains your responsibility.

## 11. General

11.1 You are an independent business. Nothing here makes you our employee, worker, agent, partner or joint venturer.

11.2 We may change this agreement on reasonable notice. Continuing to list after the change takes effect is acceptance.

11.3 This agreement is governed by the law of Scotland and subject to the jurisdiction of the Scottish courts.

---

Galloway Getaways Ltd, {{REGISTERED_OFFICE}}. Registered in Scotland, company number {{COMPANY_NUMBER}}.
`;
