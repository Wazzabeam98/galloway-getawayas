// Supabase client that bypasses row-level security, for routes that act on
// behalf of the platform rather than a signed-in user.
//
// Server-side only — never import this into a 'use client' file.
//
// The key is required rather than defaulted. A missing key used to fall back
// to '', which builds a client that fails later inside a query as an opaque
// auth error; this throws at the call site naming the variable instead.

import { createClient } from '@supabase/supabase-js';

export function serviceRoleKey(): string {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    return key;
}

export function supabaseUrl(): string {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
    return url;
}

export function adminClient() {
    return createClient(supabaseUrl(), serviceRoleKey(), {
        auth: { persistSession: false },
    });
}
