// Which social sign-in providers are actually usable right now.
//
// A "Continue with Google" button that opens Supabase, gets told the provider
// is disabled, and bounces the visitor back to an error is worse than no
// button at all — it reads as the site being broken rather than as a feature
// that isn't switched on. So the button is only rendered once the provider is
// genuinely configured.
//
// The answer comes from Supabase itself rather than from a build-time flag,
// via the public /auth/v1/settings endpoint. That means enabling Google in the
// Supabase dashboard is the only step: the button appears on its own, with no
// deploy, and the two Supabase projects can never disagree with what the app
// believes about them.
//
// This deliberately fails closed. Any error — offline, endpoint moved, project
// paused — leaves the button hidden, because a hidden button costs a visitor
// nothing and a dead one costs them a sign-in attempt.

export type ProviderName = 'google';

let inFlight: Promise<Record<string, boolean>> | null = null;

interface LoadOptions {
    fetchImpl?: typeof fetch;
    url?: string;
    anonKey?: string;
}

async function load(options: LoadOptions = {}): Promise<Record<string, boolean>> {
    const url = options.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = options.anonKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return {};

    const doFetch = options.fetchImpl ?? fetch;
    const response = await doFetch(`${url}/auth/v1/settings`, {
        headers: { apikey: anonKey },
    });
    if (!response.ok) {
        throw new Error(`Supabase settings responded ${response.status}`);
    }

    const body = await response.json();
    return (body && body.external) || {};
}

/**
 * The provider map from Supabase, cached for the life of the page.
 *
 * Cached as the in-flight promise, so several buttons mounting at once share
 * one request. A failure clears the cache rather than caching itself, so the
 * next attempt can succeed — a visitor who opens the modal again after their
 * connection comes back should get the button.
 */
export async function externalProviders(options: LoadOptions = {}): Promise<Record<string, boolean>> {
    if (!inFlight) {
        inFlight = load(options).catch(() => {
            inFlight = null;
            return {};
        });
    }
    return inFlight;
}

export async function isProviderEnabled(
    provider: ProviderName,
    options: LoadOptions = {}
): Promise<boolean> {
    const providers = await externalProviders(options);
    return providers[provider] === true;
}

/** Testing seam, and a way to re-ask after a sign-in attempt fails. */
export function resetProviderCache(): void {
    inFlight = null;
}
