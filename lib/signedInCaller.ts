import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

// Who is calling this route, VERIFIED — getUser() checks the token with
// Supabase; getSession() only decodes the cookie and would believe a forged one.
// Null for anybody not signed in, and for any failure reading it: a route
// that uses this must treat "unknown" exactly like "signed out".
export async function signedInCaller(): Promise<{ id: string; email: string } | null> {
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !user.email) return null;
        return { id: user.id, email: user.email };
    } catch {
        return null;
    }
}
