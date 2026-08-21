import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse, NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Where every inbound auth link lands: signing in with Google or Facebook,
// confirming a new account, and resetting a forgotten password.
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
//   ?token_hash=&type= What the email templates send once they are switched to
//                     {{ .TokenHash }}. No verifier, so a link requested on a
//                     laptop still works when opened on a phone — which is how
//                     people actually read their email.
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
        if (tokenHash && type) {
            const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
            if (error) throw error
        } else {
            const { error } = await supabase.auth.exchangeCodeForSession(code as string)
            if (error) throw error
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
