# Auth email templates — the link must go through /auth/callback

These templates live in the Supabase dashboard (Authentication → Emails), not in
this repo, so there is nothing here that deploys them. This note records what
their links must contain and why, because the dashboard's "Reset template"
button and a stray edit can both silently reintroduce the bug below, and nothing
in CI can catch it.

## The rule

Every link in an auth email must point at the app's own callback:

```
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=<type>
```

and **never** at the raw `{{ .ConfirmationURL }}` (which is
`https://<ref>.supabase.co/auth/v1/verify`). The `<type>` per template:

| template | type | extra |
|---|---|---|
| Confirm sign up | `email` | — |
| Magic link or OTP | `email` | — |
| Reset password | `recovery` | `&next=/auth/reset` (so it lands on the set-a-new-password page) |
| Change email address | `email_change` | — |

Replace **every** occurrence in each template — the button `href`, the "copy and
paste this link" `href`, and that link's visible text.

## Why

The 6-digit code in the email and the one-tap link are the **same one-time
token**. A business inbox's link scanner (Microsoft Safe Links, Mimecast,
Proofpoint) issues a GET to every link in a message *before* the recipient opens
it. A GET to `.../auth/v1/verify` makes GoTrue **spend the token** then and
there (it returns 303 and even mints a session). The recipient then types their
still-fresh code and gets "Token has expired or is invalid".

`app/auth/callback/route.ts` exists precisely to stop this: a GET renders an
interstitial and verifies **nothing**, so a scanner spends nothing; the token is
only spent when a human presses the button (a POST) or types the code. That
defence only works if the email link points at `/auth/callback?token_hash=…` —
the raw `{{ .ConfirmationURL }}` bypasses it entirely.

This bit a real new experience provider on 6 Oct 2026 (business inbox, brand-new
account that had to use the emailed code). Not the code length (6), the lifetime
(3600s) or the verify type — `verifyOtp` with `type: 'email'` handles both
signup-confirmation and magic-link codes. It was only the link.

## The simpler alternative

The TEST project (`yefoqcabuijcowoqewtc`) uses **code-only** templates — just
`{{ .Token }}`, no link at all — which is why it never had the bug. A code-only
email is bulletproof here because the sign-up/sign-in wizard
(`components/auth/EmailFirstStep.tsx` → `lib/emailCodeSignIn.ts`) only ever uses
the typed code. Production keeps the one-tap link, made scanner-safe by the rule
above.

## Checking a change

There is no automated check (templates are dashboard config). To confirm a link
is safe, open the template's Source and make sure no `{{ .ConfirmationURL }}`
remains, and that each link reads
`{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=<type>`. A scanner
GET of that URL returns the "Finish signing in" interstitial and leaves the code
working; a GET of the raw verify URL burns it.
