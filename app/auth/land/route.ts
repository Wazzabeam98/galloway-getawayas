import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse, NextRequest } from 'next/server'
import { landingFor } from '@/lib/workMode'
import { readWorkSide } from '@/lib/workSide'

export const dynamic = 'force-dynamic'

// The step after signing in from the account menu, by any route — the code in
// the panel, the emailed link, Google. As on Airbnb, it puts you back on the
// side you were last on: an approved host or provider who was hosting (or has
// never chosen) goes to their dashboard; anyone travelling, and every plain
// guest, goes back to the page they signed in from (lib/workMode).
//
// Sign-ins started from a task on a page — the booking box, a review link, a
// trip invite — never come through here; they stay where they were.

function safeFrom(raw: string | null): string {
    // Our own paths only, as in the callback: anything else is an open redirect.
    if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
    return raw
}

export async function GET(request: NextRequest) {
    const url = new URL(request.url)
    const from = safeFrom(url.searchParams.get('from'))
    const supabase = createRouteHandlerClient({ cookies })
    let to = from
    try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
            const side = await readWorkSide(supabase, user.id)
            to = landingFor(cookies().get('gg_mode')?.value, side, from)
        }
    } catch {
        // Never let the side check block a sign-in: fall back to where they were.
    }
    // 303, so the page itself is fetched with a GET whatever method arrived here.
    return NextResponse.redirect(new URL(to, url.origin), 303)
}

// The callback answers with a 303, so this is reached with a GET. A POST is
// answered the same way all the same, in case anything forwards one here.
export const POST = GET
