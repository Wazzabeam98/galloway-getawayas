// A tradesman applies, in a real browser, from the trade picker to the
// confirmation — and the row is checked in the database afterwards.
//
// This is the test that did not exist while two faults shipped. Both were
// client-side, both were found by hand in under a minute, and the whole
// automated suite was green through both, because nothing had ever pressed the
// button. What it asserts is therefore deliberately end-to-end and rude about
// it: the panel a person reads, and the row a person is waiting on.

import { test, expect } from '@playwright/test';
import { removeApplicant, findUser, providersOwnedBy, areasFor } from './helpers';

// Which step is on screen, told from the controls it has rather than from the
// step counter. The counter is rendered twice — once for narrow screens with
// the number in it, once wider without — so matching its text finds a hidden
// element on a desktop viewport and fails for a reason that has nothing to do
// with the application.
const onStep = {
    trade: (p: any) => p.getByRole('button', { name: /maintenance|repairs/i }).first(),
    business: (p: any) => p.getByPlaceholder('Solway Sparkle'),
    finish: (p: any) => p.getByRole('button', { name: /create account and send/i }),
};

// The form's inputs carry no id, name or aria-label, so getByLabel finds
// nothing even though the labels are on screen. Two have placeholders; the
// contact email and phone have neither, and are told apart only by order.
//
// So the email is found by where it sits: the first input BELOW that label.
// That is a layout relationship rather than a count, so inserting a field
// elsewhere on the step does not silently move it.
//
// It is still a weaker locator than a label would be, and it cannot fail
// quietly: the account is created from whatever went into that box, so a
// mis-targeted fill produces no account on this address and the database
// assertions below fail loudly.
//
// The real fix is aria-labels on those inputs, which would help anybody using a
// screen reader as much as it helps this test. Noted rather than done, because
// it is an app change and this is a test.
const contactEmailField = (p: any) =>
    p.locator('input:below(:text("Email for us to reach you on"))').first();

// Its own address, on a domain nothing else uses, so a leftover from a previous
// run can never make a failure look like a pass.
const EMAIL = 'e2e-joiner@gallowayauto.test';
const PASSWORD = 'e2e-playwright-password-1';
const BUSINESS = 'E2E Joinery';

test.beforeEach(async () => { await removeApplicant(EMAIL); });
test.afterEach(async () => { await removeApplicant(EMAIL); });

const DRAFT = {
    step: 'account', trade: 'joiner',
    businessName: BUSINESS,
    description: 'Second fix, sash windows and general joinery across the Stewartry.',
    contactEmail: EMAIL, contactPhone: '01557 000000',
    prices: {}, extras: {}, calloutFee: '45', hourlyRate: '30',
    areas: [{ town: 'Kirkcudbright', radius_miles: 10 }],
    pricingChoice: 'bands', billableHourlyRate: '', coveredBands: [],
    doesGas: false, doesOil: false, registrations: {}, calloutWaived: false,
    skills: [], photos: [], logo: null, buildingType: '', panes: {},
};

/**
 * Put a filled-in application in the browser and open the form on it.
 *
 * WHAT THIS DOES AND DOES NOT COVER, said plainly so nobody reads more into a
 * green run than is there.
 *
 * It restores a draft rather than typing every field through all five steps.
 * The restore is the same mechanism a real applicant uses whenever they come
 * back to a half-finished form, so it is a real path and not a back door — but
 * it does mean the earlier steps' own controls are not exercised here.
 *
 * What it DOES cover is the part that has actually broken twice: the press
 * itself, what the applicant is told afterwards, and whether a row exists. Both
 * faults that shipped were on this screen and after this button.
 *
 * Extending it to drive the picker and the coverage control from step one is
 * the next increment — see MAINTENANCE.md.
 */
async function openOnFinishStep(page: any, contactEmail: string = EMAIL) {
    await page.goto('/services/join?trade=joiner');
    await page.evaluate((d: any) => {
        localStorage.setItem('gg.provider-draft.joiner', JSON.stringify(d));
    }, { ...DRAFT, contactEmail });
    await page.reload();
    await expect(onStep.finish(page)).toBeVisible();
}

test('the press lodges the application, says so, and the row is there', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (m: any) => { if (m.type() === 'error') problems.push(m.text()); });

    await openOnFinishStep(page);

    await page.getByPlaceholder(/at least 8 characters/i).fill(PASSWORD);
    await page.getByRole('checkbox').first().check();

    const lodged = page.waitForResponse(
        (r: any) => r.url().includes('/api/services/apply') && r.request().method() === 'POST'
    );
    await onStep.finish(page).click();
    const response = await lodged;
    expect(response.status(), 'the apply route accepted it').toBe(200);

    // What the applicant is told. The fault: the press worked, the row was
    // written, and the form put them back on the business step with nothing on
    // screen to say so — success and refusal looked identical.
    await expect(page.getByText('Your application is in', { exact: false })).toBeVisible();
    await expect(onStep.business(page)).toBeHidden();

    // What is actually in the database.
    const user = await findUser(EMAIL);
    expect(user, 'the account exists').toBeTruthy();
    expect(user.email_confirmed_at || user.confirmed_at, 'and is unconfirmed').toBeFalsy();

    const owned = await providersOwnedBy(user.id);
    expect(owned.length, 'exactly one application').toBe(1);
    expect(owned[0].business_name).toBe(BUSINESS);
    expect(owned[0].trade).toBe('joiner');
    expect(owned[0].status, 'lodged, not left as a draft').toBe('pending_review');
    expect(owned[0].submitted_at, 'it carries when it was sent').toBeTruthy();

    const areas = await areasFor(owned[0].id);
    expect(areas.length, 'its coverage was written too').toBeGreaterThan(0);

    expect(problems, 'no console errors along the way').toEqual([]);
});

test('the trade picker leads to the business step', async ({ page }) => {
    // The one part of the earlier walk that is worth holding: step one is how
    // the trade gets into the URL, and a wrong trade there is what made a draft
    // unfindable the first time this was walked by hand.
    await page.goto('/services/join');
    await onStep.trade(page).click();
    await page.getByRole('button', { name: /^Joiner$/ }).first().click();

    await expect(onStep.business(page)).toBeVisible();
    await expect(page).toHaveURL(/trade=joiner/);
});

test('an address that already has an account is told so, loudly, and sends nothing', async ({ page }) => {
    // The other way this screen can end, and the one that was quiet enough to
    // be mistaken for success: it was a small red sentence where a success is a
    // bordered panel.
    await openOnFinishStep(page, 'auto-guest@gallowayauto.test');

    await page.getByPlaceholder(/at least 8 characters/i).fill(PASSWORD);
    await page.getByRole('checkbox').first().check();
    await onStep.finish(page).click();

    await expect(page.getByText('Nothing has been sent', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /use a different address/i })).toBeVisible();
    await expect(page.getByText('Your application is in', { exact: false })).toBeHidden();

    // And it really did not send: no application landed on that account.
    const existing = await findUser('auto-guest@gallowayauto.test');
    const owned = await providersOwnedBy(existing.id);
    expect(owned.filter((p: any) => p.business_name === BUSINESS).length).toBe(0);
});
