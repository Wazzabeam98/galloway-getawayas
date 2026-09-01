# Guest experiences — go-live, in the order you do it

Migrate, merge, prove the webhook with a real card, onboard a chef, flip the
flag. Do it in this order, alone, and check what you should see at each step
before moving on.

> **Order matters — migrate before you merge.** The deployed code references
> columns (`provider_name`, `based_line`, `headshot`, `stripe_mcc`,
> `custom_label`, `category_assigned_at`, plus the `service_orders` bits) that
> the migrations add. Adding columns is backward-compatible — the old
> production code ignores them — so running the migrations first is safe, and
> it means the new code lands on a database that already has what it needs. Do
> it the other way round and provider sign-up/edit and `/admin/providers` error
> until the migration catches up.

**Before you start.** You need: PR #66 reviewed; the ability to run
`scripts/migrate.mjs` against production (`SUPABASE_PROD_DB_URL` in
`.env.local`); access to the Vercel project settings and the Stripe **live**
dashboard. Do it in a quiet window — the guest flag stays off until the last
step, so nothing changes for guests while you work, and there are no approved
providers on production yet. Only step 5 turns it on.

---

## 1 · Run the migrations on production

Without these the routes error the instant the flag is on — and provider
edit/sign-up breaks the moment the new code deploys. They use `if [not]
exists`, so running one that's already applied is a harmless no-op; run all in
order to be sure. This assumes the services base tables (the host/plumber side)
are already on production, which they are if that side is live.

**First, see what's already there:**

```bash
node scripts/migrate.mjs --sql "select to_regclass('public.service_orders') as orders_table, (select count(*) from information_schema.columns where table_name='service_providers' and column_name in ('experience_price','provider_name','stripe_mcc')) as new_provider_cols" --target prod
```

**Then run, in this order** — dry-run first (prints the plan, changes nothing),
then `--apply`:

1. `20260829030000_service_orders_and_provider_connect.sql` — the orders table, the provider's own Stripe columns, the fixed price. *(May already be on prod from the earlier flagged release — the `if not exists` guard makes it safe either way.)*
2. `20260831210000_guest_experience_profile_and_other.sql` — name / line / headshot + the "other" category columns.
3. `20260901120000_one_experience_per_chef_per_date.sql` — the no-double-booking index.
4. `20260901140000_trim_guest_profile_to_a_name_and_a_line.sql` — **drops** `about` + `what_to_expect`; needs `--destructive` as well as `--apply`.

```bash
node scripts/migrate.mjs <file> --target prod            # dry run — read the plan
node scripts/migrate.mjs <file> --target prod --apply    # run it (add --destructive for #4)
node scripts/migrate.mjs <file> --target prod --apply --read "select ..."   # read back
```

- **You should see:** each apply prints `committed`, and a read-back shows the object exists. #4 refuses without `--destructive` — that's the guard; add it and re-run.
- **If it refuses "not the prod project":** expected safety — `SUPABASE_PROD_DB_URL` isn't pointed where you think. Fix that, don't force it.

## 2 · Merge PR #66

Ships the code onto a database that now has the columns it needs.

- **Do:** GitHub → PR #66 → **Merge pull request** → Confirm.
- **You should see:** Vercel starts a **Production** deployment of `master`; wait for **Ready** (green). The branch built clean, so this should too.
- **If the deploy fails:** a red build here is an environment difference, not the code. Read the Vercel log; don't go on. The feature is still dark (flag off).

## 3 · Verify the webhook — config first

The single most likely silent failure. A guest paying starts a Stripe Checkout;
the order row is created **only** when Stripe calls `/api/stripe/webhook` with
`checkout.session.completed`. If that's misconfigured, the guest's card is held,
no order is made, the chef never hears, and the hold quietly expires.

- **Do:**
  1. Stripe Dashboard → **live mode** (top left) → **Developers → Webhooks**.
  2. Confirm an endpoint with URL `https://<your production domain>/api/stripe/webhook`. Add one if it's missing.
  3. Open it → confirm it listens for **checkout.session.completed** (and, for the rest of the handler: **account.updated**, **charge.refunded**, **charge.dispute.created**).
  4. **Reveal** the signing secret. Confirm it matches `STRIPE_WEBHOOK_SECRET` in Vercel → Settings → Environment Variables → **Production**. This is the field most often wrong.
- **You should see:** an endpoint on your live domain, subscribed to those events, with a signing secret that **matches Vercel exactly**.
- **If the secret doesn't match:** every event is rejected at the signature check and no order is ever created. Copy the endpoint's secret into Vercel (Production), redeploy, re-check. You'll prove it end to end in step 6.

While you're in the env vars, confirm `RESEND_API_KEY` is set for Production and
the sending address is a verified Resend domain — the guest confirm/decline
emails and the "a guest would like to book you" email to chefs depend on it.

## 4 · Onboard your first chef

The biggest unknown — never done for real. Do it before you flip the flag, so
there's someone live when guests can look. A chef can apply, be approved, and
connect Stripe while the guest flag is still off; the flag only gates the guest
side. Approval is the first gate; **Stripe payouts is the second**, and a chef
is invisible to guests until it clears. Be on the phone with them the first
time.

- **Do:**
  1. Chef applies at `/services/join` (private chef, or "something else").
  2. You approve in `/admin/providers`. For an "other" trade you also pick the Stripe category and the word guests see — Approve stays greyed until you do.
  3. Chef opens `/services/dashboard` → **Set up payouts** → sent to Stripe's hosted onboarding.
  4. They complete it. The dashboard flips from "one step before guests can book you" to **"you're live to guests"** once Stripe enables payouts.

**What Stripe asks a chef for — tell them beforehand:**

- **Who they are:** legal name, date of birth, home address, phone, email.
- **A bank account** for payouts — UK sort code and account number in their name.
- **What they do:** a one-line description (the category is already set from your side).
- **Proof of identity:** usually a photo of a passport or driving licence, sometimes a quick selfie. Stripe may accept them on the spot, or come back a day or two later asking for more — normal, and until it's satisfied, **payouts stay off and the chef isn't bookable**.

Ask them to have their **bank details and a photo of their ID** to hand — about
ten minutes if they do. Warn them it can say "pending" while Stripe reviews;
that's Stripe, not you.

- **You should see:** on the chef's dashboard, "you're live to guests"; in the DB, `stripe_payouts_enabled = true`. Only then do they show to a guest.
- **If they stall:** this is the step most likely to stick, and it's out of your hands once they're in Stripe's flow. Better to find out here, with a chef you can call, than after you've promised guests.

**Also true before a guest sees anyone:** the chef needs a coverage area set,
and there must be a real cottage **with coordinates** inside it — a listing with
no lat/long matches no chef.

## 5 · Flip the flag

- **Do:** Vercel → Settings → Environment Variables → Production → set `GUEST_EXPERIENCES_OPEN` to `true` → **redeploy** (env changes need a fresh deploy).
- **You should see:** on a trip page for a cottage your live chef covers, the "coming soon" box is replaced by the experience — the chef's card, photos, price, and a "Request & hold my card" button.
- **Roll back is one switch:** if step 6 goes wrong, set the flag back to `false` and redeploy — guests instantly see "coming soon" again and the order route refuses. Nothing else to undo.

## 6 · Prove the webhook end to end, with a real card — before any real guest

The acceptance test. You can only place a real order once the flag is on, so
this is the first thing you do the moment it is — as the guest, yourself, before
you tell anyone. The card is **held, not charged** (manual capture), so
declining afterwards takes nothing.

- **Do:**
  1. As a guest with a real, paid booking at a cottage your live chef covers, open the trip page → request the chef → pay with a **real card** (authorised, not charged).
  2. Check the chef's `/services/dashboard` — the request should be there to answer.
  3. As the chef, press **Decline**. The hold is released; nothing captured.
- **You should see:**
  - Stripe → Webhooks → your endpoint → **Events**: a `checkout.session.completed` delivered with a **200**.
  - The order in the chef's dashboard, and the "a guest would like to book you" email in the chef's inbox.
  - After the decline: the card authorisation drops off — nothing charged.
- **If no order appears:** the webhook isn't working in production — the exact silent failure step 3 guards against. Flip the flag back to `false`, then fix it (the Events tab shows a 4xx or no delivery: wrong secret, wrong URL, or the event isn't subscribed). Do not leave it live.

Once you've seen the order appear and the email land, do it once more and this
time **Confirm** it — watch the capture, check the 10% lands with you and the
rest with the chef, then refund it (it's your own test). Now a real guest can be
told it works, because you've watched it work.

---

**Order:** migrate prod → merge → verify webhook config → onboard one chef →
flip the flag → prove it end to end with a real card. The two that have never
run for real are the production webhook (steps 3/6) and live Stripe onboarding
(step 4). Everything else is proven on test.

**Roll-back at any point:** set `GUEST_EXPERIENCES_OPEN=false` and redeploy.
Guests see "coming soon"; nothing charged.
