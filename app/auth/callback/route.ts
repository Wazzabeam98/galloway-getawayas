import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse, NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Where every inbound auth link lands: signing in with Google, confirming a
// new account, and resetting a forgotten password.
//
// Until now only the social buttons pointed here, because they were the only
// thing that set redirectTo. The confirmation email went to the Site URL
// instead — the home page — which has no Supabase client running on it and so
// nothing that could turn the link into a session. That is why a guest who
// confirmed their address arrived signed out.
//
// Two shapes of link are accepted, and the difference matters:
//
//   ?code=            PKCE. Only works in the same browser that asked for it,
//                     because the matching verifier is in a cookie there.
//                     This is what the OAuth buttons produce.
//
//   ?token_hash=&type= What the email templates send. No verifier, so a link
//                     requested on a laptop still works when opened on a phone —
//                     which is how people actually read their email. The emails
//                     are asked for through lib/supabaseEmailFlow.ts, which runs
//                     implicit flow precisely so that stays true; ask through
//                     the ordinary client and the hash comes back pkce_-prefixed
//                     and bound to one device.
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

export async function GET(request: NextRequest) {
    const url = new URL(request.url)
    const origin = url.origin
    const next = safeNext(url.searchParams.get('next'))
    const code = url.searchParams.get('code')
    const tokenHash = url.searchParams.get('token_hash')
    const type = url.searchParams.get('type') as EmailOtpType | null

    // Supabase turned the link down before it ever reached us — expired,
    // already used, or issued by a different project. It says why, so say why.
    const refused = url.searchParams.get('error_description') || url.searchParams.get('error')
    if (refused) return backHome(origin, refused)

    if (!code && !tokenHash) {
        return backHome(origin, 'That link is missing its sign-in code. Please ask for a new one.')
    }

    const supabase = createRouteHandlerClient({ cookies })

    // Both of these THROW on a bad link rather than returning an error — which
    // is what made the old version look like it worked. Catch, don't destructure.
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

        // No error AND no session is the quiet failure this route used to wave
        // through. It redirected to `next`, the page rendered signed out, and a
        // link that had not worked was indistinguishable from one that had —
        // which is exactly how a broken confirmation link looked like a working
        // one. Checking `error` alone is not enough: absence of a complaint is
        // not presence of a session.
        //
        // A pkce_-prefixed hash should no longer reach us — the auth emails are
        // requested in implicit flow — but one can still arrive from a link sent
        // before that change, or if someone wires a new email up to the ordinary
        // client by mistake. Such a hash is bound to the storage of the browser
        // that asked for it, so opened anywhere else /verify has nothing to hand
        // back and says so by saying nothing. Name that case: retrying the link
        // cannot fix it, asking for a fresh one can.
        if (!session) {
            if (tokenHash && tokenHash.startsWith('pkce_')) {
                return backHome(
                    origin,
                    'That link has to be opened on the device you signed up from. Ask for a new one here and it will work.'
                )
            }
            return backHome(
                origin,
                'That link was accepted but did not sign you in. Please ask for a new one.'
            )
        }
    } catch (err: any) {
        const message: string = (err && err.message) || 'That link could not be used.'

        // The one failure worth translating. It means the link was opened in a
        // different browser from the one that asked for it, and no amount of
        // retrying the same link will fix it.
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
