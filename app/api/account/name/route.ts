import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabaseAdmin';
import { logError } from '@/lib/logError';
import { validatePersonName } from '@/lib/personName';

export const dynamic = 'force-dynamic';

// The signed-in person's own first and last name — the ONLY writer of
// profiles.first_name / last_name (the browser has SELECT on them and nothing
// else; 20261019153817). The check is lib/personName's validatePersonName, the
// same one the Finish signing up form runs, so the rule cannot be stepped
// round by writing the row from the console.
//
// full_name is kept in step as "first last": admin screens, Stripe and the
// older reads still use it.
//
// getUser(), not getSession(): the id written to is the verified one. Phone
// accounts have no email, so this does not go through signedInCaller (which
// treats a missing email as signed out).
export async function POST(req: Request) {
    let userId: string | null = null;
    try {
        const supabase = createRouteHandlerClient({ cookies });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ ok: false, error: 'Log in to continue.' }, { status: 401 });
        userId = user.id;

        const body = await req.json().catch(() => ({}));
        const check = validatePersonName(body && body.first, body && body.last);
        if (!check.ok) {
            return NextResponse.json({ ok: false, field: check.field, error: check.message }, { status: 400 });
        }

        const { error } = await adminClient()
            .from('profiles')
            .update({ first_name: check.first, last_name: check.last, full_name: check.first + ' ' + check.last })
            .eq('id', user.id);
        if (error) {
            await logError('account name save failed', error.message, { path: '/api/account/name', userId: user.id });
            return NextResponse.json({ ok: false, error: 'We couldn’t save your name. Try again.' }, { status: 500 });
        }
        return NextResponse.json({ ok: true, first: check.first, last: check.last });
    } catch (err: any) {
        await logError('account name save failed', String((err && err.message) || err), { path: '/api/account/name', userId: userId || undefined });
        return NextResponse.json({ ok: false, error: 'We couldn’t save your name. Try again.' }, { status: 500 });
    }
}
