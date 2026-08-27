// The client used ONLY to ask Supabase to send an auth email.
//
// Everything else in the app uses `createClientComponentClient()` from
// auth-helpers, which hardcodes `flowType: "pkce"` and cannot be talked out of
// it — `createSupabaseClient` in auth-helpers-shared spreads your options first
// and then rebuilds the whole `auth` object over the top, keeping only
// `storage` and `storageKey`. Passing `flowType` to it is not an error; it is
// simply ignored. Hence a separate client rather than an option.
//
// WHY a different flow for these three calls:
//
// Under PKCE, `signUp` and `resetPasswordForEmail` generate a code verifier,
// stash it in the storage of the browser making the request, and send Supabase
// only its hash. The confirmation email then arrives carrying a pkce_-prefixed
// token hash that can only be redeemed by proving possession of that verifier —
// which exists on exactly one device. Sign up on a laptop, open the email on a
// phone, and it can never work. That is not a bug in any library version and no
// upgrade fixes it: binding the link to the initiator is what PKCE is for.
//
// People read their email on their phones. So for the calls that send a link
// meant to be clicked elsewhere, we ask in implicit flow: no verifier, no
// code_challenge, and a plain token hash the callback can redeem from anywhere.
//
// WHAT THIS DOES NOT CHANGE. Google sign-in stays on the auth-helpers client
// and stays on PKCE. That is where PKCE genuinely earns its keep — it stops an
// intercepted authorization code being redeemed by someone else — and switching
// OAuth to implicit would return tokens in the URL fragment, which a server
// route handler never receives, breaking the button outright.
//
// THE TRADE. A non-PKCE confirmation link is a bearer token: whoever can read
// the inbox can use it. That is already true of every password reset email ever
// sent, and the usual objection to implicit flow — access tokens sitting in URL
// fragments and browser history — does not apply here, because this path puts
// the token hash through a server route and comes back as httpOnly cookies. The
// links stay single-use and short-lived; that is Supabase's side of it.
//
// DO NOT reach for this client for anything else. It deliberately keeps no
// session (see below), so signing in with it would appear to work and then
// leave the visitor signed out. `lib/supabase.ts` is the one you want.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

interface ClientOptions {
    url?: string;
    anonKey?: string;
    fetchImpl?: typeof fetch;
}

/**
 * Build an email-flow client.
 *
 * `persistSession` is off on purpose. With email confirmation switched on —
 * which is how the project is configured — `signUp` and `resetPasswordForEmail`
 * both return a user and no session, so there is nothing to keep. Any session
 * that does come back is handed to the auth-helpers client by the caller, so
 * that it lands in the cookies the rest of the site reads. See the
 * `data.session` branch in the sign-up forms.
 */
export function createEmailFlowClient(options: ClientOptions = {}): SupabaseClient {
    const url = options.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = options.anonKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
        throw new Error('Supabase URL and anon key are required for the email-flow client.');
    }

    return createClient(url, anonKey, {
        auth: {
            // The whole point of this module.
            flowType: 'implicit',
            // This client exists for one request at a time. It must never own a
            // session, refresh one, or read one out of the URL — that is the
            // auth-helpers client's job, and two clients both writing session
            // state is a very good way to spend an afternoon.
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        },
        ...(options.fetchImpl ? { global: { fetch: options.fetchImpl } } : {}),
    });
}

let client: SupabaseClient | null = null;

/**
 * The shared email-flow client. Built on first use so that a missing env var
 * fails where it is called rather than at import time.
 */
export function supabaseEmailFlow(): SupabaseClient {
    if (!client) client = createEmailFlowClient();
    return client;
}
