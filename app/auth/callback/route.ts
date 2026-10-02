import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse, NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Where every inbound auth link lands: signing in with Google, confirming a
// new account (the sign-up verification link), a magic link, and resetting a
// forgotten password. All of them arrive here.
//
// Two shapes of link are accepted, and the difference matters:
//
//   ?code=            PKCE. Only works in the same browser that asked for it,
//                     because the matching verifier is in a cookie there.
//                     This is what the OAuth buttons produce. A mail scanner
//                     that fetches it has no verifier, so it cannot spend it —
//                     and it arrives from an OAuth redirect, not an email — so
//                     it is completed on GET as before.
//
//   ?token_hash=&type= What the email templates send. No verifier, so a link
//                     requested on a laptop still works when opened on a phone —
//                     which is how people actually read their email. That very
//                     property is the danger: because it is bound to no browser,
//                     ANY client that fetches the URL can spend it, and a
//                     token is single-use. Outlook (and other mail providers)
//                     fetch every link in a message with a GET to scan it —
//                     BEFORE the recipient clicks — and that GET was consuming
//                     the token. The human then clicked an already-spent link
//                     and could not sign in: a guest confirming their account or
//                     a provider verifying their email was silently lost.
//
//                     THE FIX. A GET carrying a token renders an INTERSTITIAL and
//                     consumes nothing. A scanner does a GET and submits no form,
//                     so it spends nothing. The token is verified only when a
//                     human presses the button, which POSTs it back. Cross-device
//                     is untouched: the token travels in the form, not a browser,
//                     so the phone that opened the laptop's link completes the
//                     sign-in — it just costs one tap. This mirrors how the app's
//                     own token pages already work (render on GET, act on submit).
//
// ?next= is where to go once the session exists. The reset email uses it to
// land on the set-a-password form rather than the home page.

function safeNext(raw: string | null): string {
    // Our own paths only. Anything else and this becomes an open redirect: a
    // phishing link wearing the site's own domain.
    if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/'
    return raw
}

function backHome(origin: string, message: string) {
    return NextResponse.redirect(new URL('/?error=' + encodeURIComponent(message), origin))
}

// Escape a value for an HTML attribute — the token, type and next go into the
// interstitial form's hidden inputs, so a stray quote must not break out of them.
function attr(value: string): string {
    return String(value)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// The interstitial: a real page with a form that POSTs the token back. No
// verifyOtp runs here, so a GET — from a scanner, a link preview, a browser
// preload — consumes NOTHING. The copy says what is happening; it does not claim
// anything expired, because nothing has.
function interstitial(tokenHash: string, type: string, next: string) {
    const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Finish signing in · Galloway Getaways</title>
<style>
 :root{color-scheme:light}
 body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
   background:#f8fafc;color:#0f172a;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px}
 .card{max-width:26rem;width:100%;text-align:center;background:#fff;border:1px solid #e2e8f0;
   border-radius:16px;padding:32px 28px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
 h1{font-size:1.5rem;font-weight:800;margin:0 0 8px}
 p{color:#475569;margin:0 0 20px}
 button{width:100%;border:0;border-radius:12px;background:#047857;color:#fff;
   font-size:1rem;font-weight:600;padding:12px 16px;cursor:pointer}
 button:hover{background:#065f46}
 small{display:block;margin-top:16px;color:#94a3b8;font-size:.8rem}
</style></head><body>
 <main class="card">
  <h1>Almost there</h1>
  <p>Press the button to finish signing in.</p>
  <form method="POST" action="/auth/callback">
   <input type="hidden" name="token_hash" value="${attr(tokenHash)}">
   <input type="hidden" name="type" value="${attr(type)}">
   <input type="hidden" name="next" value="${attr(next)}">
   <button type="submit">Finish signing in</button>
  </form>
  <small>This one tap stops automated email scanners from using your link before you do.</small>
 </main>
</body></html>`
    return new NextResponse(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
}

// Verify a link and land the session. Shared by the POST (a human pressing the
// interstitial button) and the GET's OAuth-code path. THROWS on a bad link
// rather than returning an error — so catch, don't destructure.
async function complete(
    args: { tokenHash?: string; type?: EmailOtpType | null; code?: string | null; next: string; origin: string },
): Promise<NextResponse> {
    const { tokenHash, type, code, next, origin } = args
    const supabase = createRouteHandlerClient({ cookies })
    try {
        let session = null
        if (tokenHash && type) {
            const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
            if (error) throw error
            session = data.session
        } else {
            const { data, error } = await supabase.auth.exchangeCodeForSession(code as string)
            if (error) throw error
            session = data.session
        }

        // No error AND no session is the quiet failure the old route waved
        // through: it redirected and the page rendered signed out, so a link
        // that had not worked looked like one that had. Name the case instead.
        if (!session) {
            if (tokenHash && tokenHash.startsWith('pkce_')) {
                return backHome(
                    origin,
                    'That link has to be opened on the device you signed up from. Ask for a new one here and it will work.'
                )
            }
            return backHome(
                origin,
                'That link did not sign you in. Ask for a new one here and it will work.'
            )
        }
    } catch (err: unknown) {
        const message: string = (err instanceof Error && err.message) || 'That link could not be used.'
        // The one failure worth translating: opened in a different browser from
        // the one that asked for it (PKCE), which retrying cannot fix.
        if (message.includes('code verifier')) {
            return backHome(
                origin,
                'That link has to be opened in the same browser you asked for it from. Ask for a new one here and it will work.'
            )
        }
        return backHome(origin, message)
    }

    return NextResponse.redirect(new URL(next, origin))
}

export async function GET(request: NextRequest) {
    const url = new URL(request.url)
    const origin = url.origin
    const next = safeNext(url.searchParams.get('next'))
    const code = url.searchParams.get('code')
    const tokenHash = url.searchParams.get('token_hash')
    const type = url.searchParams.get('type') as EmailOtpType | null

    // Supabase turned the link down before it ever reached us — expired, already
    // used, or issued by a different project. It says why, so say why.
    const refused = url.searchParams.get('error_description') || url.searchParams.get('error')
    if (refused) return backHome(origin, refused)

    if (!code && !tokenHash) {
        return backHome(origin, 'That link is missing its sign-in code. Please ask for a new one.')
    }

    // AN EMAIL TOKEN — render the interstitial and consume nothing. The token is
    // spent only by the POST below, when a human presses the button. This is what
    // stops a mail scanner's GET from burning the link before the recipient opens
    // it. Covers every emailed link that lands here: sign-up verification, magic
    // link, and password reset alike.
    if (tokenHash && type) {
        return interstitial(tokenHash, type, next)
    }

    // An OAuth code — bound to this browser and not emailed, so a scanner can't
    // spend it. Complete it on GET as before.
    return complete({ code, next, origin })
}

// The interstitial's button posts here. THIS is where the email token is spent —
// on a deliberate human action, never on a scanner's GET.
export async function POST(request: NextRequest) {
    const origin = new URL(request.url).origin
    const form = await request.formData().catch(() => null)
    const tokenHash = String(form?.get('token_hash') || '')
    const type = (String(form?.get('type') || '') || null) as EmailOtpType | null
    const next = safeNext(String(form?.get('next') || ''))

    if (!tokenHash || !type) {
        return backHome(origin, 'That link is missing its sign-in code. Please ask for a new one.')
    }

    return complete({ tokenHash, type, next, origin })
}
