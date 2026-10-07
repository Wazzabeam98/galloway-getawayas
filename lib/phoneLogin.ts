// The decision the phone sign-in pre-check makes from the three-way state that
// public.phone_login_state returns (see the migration). Kept pure and free of
// '@/' imports so the unit test runs it directly and the route stays a thin
// wrapper over the admin RPC.
//
//   'login'       — a confirmed login phone: proceed (Supabase opens that account).
//   'new'         — on no account: proceed (create one, as before).
//   'unconfirmed' — saved unconfirmed on some account: BLOCK, and point the person
//                   at the fix, so signing in never makes a second, empty account.

export type PhoneLoginState = 'login' | 'unconfirmed' | 'new';

export const PHONE_UNCONFIRMED_MESSAGE =
    'This number is saved on an account but not confirmed for logging in. '
    + 'Log in with your email, then confirm your number in your account settings.';

export function phoneLoginDecision(state: string | null | undefined): { blocked: boolean; message?: string } {
    return state === 'unconfirmed'
        ? { blocked: true, message: PHONE_UNCONFIRMED_MESSAGE }
        : { blocked: false };
}
