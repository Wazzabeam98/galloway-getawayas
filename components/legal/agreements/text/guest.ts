// The approved wording of this agreement, final as of 03/10/2026. THE ONE
// COPY — its page, the tick box's panel and the sign-in prompt all render this.
// To change it: replace the text between the backticks with the new markdown,
// then move this document's `version` and `lastUpdated` in lib/agreements.ts
// and the Version line below to match (tests/agreements.test.ts checks they agree).
//
// {{COMPANY_NUMBER}} and {{REGISTERED_OFFICE}} are filled in from
// config/company.ts when the text is drawn — the company details are written
// in that one place only (tests/company-details.test.ts).

export const GUEST_TERMS = String.raw`# Guest Terms

**Galloway Getaways Ltd** (company number {{COMPANY_NUMBER}}), registered office {{REGISTERED_OFFICE}} ("we", "us", "Galloway Getaways").

Version: v1-2026-10-03

---

## 1. Who we are and what we do

We run an online platform where owners of self-catering accommodation in Dumfries and Galloway ("Hosts") advertise their properties, and where local businesses ("Experience Providers") offer activities, food and other services to guests who have booked a stay.

**We do not own, run, or control any accommodation or experience listed on the platform.** We are not a travel agent, tour operator, or organiser of package holidays. We provide the platform and, where stated below, collect payment as the Host's or Provider's agent.

## 2. Your contract is with the Host or the Provider

When you book accommodation, **your contract for that stay is directly between you and the Host.** We act as the Host's agent for advertising the property and collecting payment.

When you book an experience, **your contract for that experience is directly between you and the Experience Provider.** We act as the Provider's agent for collecting payment.

We are not a party to either contract. We are responsible for running the platform and handling payment as described in these terms, and for nothing else.

## 3. Booking accommodation

3.1 Listings are created by Hosts. Descriptions, photographs, prices, availability and house rules are the Host's, not ours.

3.2 A booking is confirmed when you receive our confirmation email. Until then, no contract exists.

3.3 Where a Host has chosen to review requests rather than accept instantly, your payment is authorised or taken and refunded in full if the Host declines or does not respond within the stated period.

3.4 The price shown includes the nightly rate and any fees the Host has set (cleaning, pets, extra guests, damage deposit). Any charge not shown at checkout is not payable to us.

## 4. Payment

4.1 We collect payment from you as agent for the Host or the Provider. Payment to us discharges your obligation to pay them for that booking.

4.2 Payments are processed by Stripe. We do not store your card details.

4.3 Where a booking is split into a deposit and a balance, the balance is charged automatically on the date shown at checkout. If it fails, we will tell you and may cancel the booking after the period stated in your confirmation.

## 5. Cancellation and refunds

5.1 Each listing shows the Host's cancellation policy. It applies to your booking and you should read it before you book.

5.2 If you cancel, the refund due is calculated under that policy and paid to the original payment method.

5.3 If the Host cancels, you receive a full refund of everything you paid for the stay. We will help you find an alternative where we can, but we do not guarantee one and we are not liable for the cost of any replacement.

5.4 Experiences have their own cancellation terms, set by the Provider and shown before you pay.

## 6. Your stay

6.1 You agree to follow the Host's house rules, to treat the property with care, and not to exceed the number of guests booked.

6.2 You are responsible for damage you or your party cause, beyond fair wear and tear. The Host may request payment for damage through the platform. If you do not agree, it is a matter between you and the Host, though we will provide any records we hold.

6.3 You must not use a property for parties, events, or any commercial purpose without the Host's written agreement.

## 7. Experiences

7.1 Experiences are offered only to guests with a confirmed stay, after that stay is booked.

7.2 The Provider is solely responsible for the experience: for running it safely, for holding any licence, qualification or insurance the law requires, and for the quality of what is provided.

7.3 **Our approval of a Provider is not a warranty** as to their skills, quality, suitability, qualifications, credentials or insurance. We do not verify them.

7.4 You are responsible for judging whether an experience is suitable for you and your party, including for any medical condition, dietary requirement, age or ability. Tell the Provider about anything relevant before you book.

7.5 Where booking an experience during a confirmed stay may constitute a linked travel arrangement, we show you a notice at checkout explaining what that means.

## 8. Complaints

8.1 Raise a problem with the Host or Provider first, through the platform's messaging, so it can be put right during your stay.

8.2 If it cannot be resolved, contact us. We may assist, mediate, or hold or return money where our terms with the Host or Provider allow, but we are not obliged to compensate you for their acts or omissions.

## 9. Our liability

9.1 Nothing in these terms limits our liability for death or personal injury caused by our negligence, for fraud, or for anything else that cannot lawfully be limited.

9.2 Subject to 9.1, **we are not liable for the acts or omissions of any Host, Experience Provider or tradesperson**, for the condition, safety, cleanliness or description of any property, or for the conduct or performance of any experience.

9.3 Subject to 9.1, our total liability to you arising from or connected with any booking is limited to the total amount you paid to us for that booking.

9.4 We are not liable for business losses. These terms apply to you as a consumer.

9.5 We are not liable for events outside our reasonable control.

## 10. Your account

10.1 You must give accurate information and keep your sign-in details secure.

10.2 You must be 18 or over to make a booking.

10.3 We may suspend or close an account where these terms are broken, where we reasonably suspect fraud, or where a Host or Provider reports serious misconduct.

## 11. Your information

We handle your personal information as set out in our Privacy Policy. To make a booking work, we share what is necessary with your Host or Provider, including your first name and, once a booking is confirmed, contact details.

## 12. Changes

We may change these terms. Bookings already confirmed are governed by the version you accepted at the time. Material changes will be notified.

## 13. Law

These terms are governed by the law of Scotland, and the courts of Scotland have jurisdiction. If you live elsewhere in the UK, you may also bring proceedings in your own courts.

## 14. Contact

support@gallowaygetaways.co.uk
Galloway Getaways Ltd, {{REGISTERED_OFFICE}}. Registered in Scotland, company number {{COMPANY_NUMBER}}.
`;
