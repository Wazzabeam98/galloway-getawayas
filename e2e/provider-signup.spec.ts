// The trade sign-up in a real browser. The signed-out apply flow this spec
// used to drive (/api/services/apply) is gone: every sign-up now opens on the
// shared email-code step, so an application is sent signed in.

import { test, expect } from '@playwright/test';

// Which step is on screen, told from the controls it has rather than from the
// step counter. The counter is rendered twice — once for narrow screens with
// the number in it, once wider without — so matching its text finds a hidden
// element on a desktop viewport and fails for a reason that has nothing to do
// with the application.
const onStep = {
    trade: (p: any) => p.getByRole('button', { name: /maintenance|repairs/i }).first(),
    business: (p: any) => p.getByPlaceholder('Solway Sparkle'),
};

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
