"use client"

import React, { useState } from 'react'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'


const SignOut = () => {
    const supabase = createClientComponentClient();
    const [loading, setLoading] = useState(false);

    const logout = async () => {
        setLoading(true);

        // Ask the server to revoke the session. This can legitimately fail —
        // expired token, no connection, or an account that no longer exists.
        try {
            await supabase.auth.signOut();
        } catch (err) {
            console.error('Server sign-out failed:', err);
        }

        // Whatever the server said, clear the session held in this browser.
        // Logout must never leave someone signed in on the device in front of
        // them just because a network call failed.
        try {
            await supabase.auth.signOut({ scope: 'local' });
        } catch (err) {
            console.error('Local sign-out failed:', err);
        }

        // A FULL-DOCUMENT navigation, not router.push('/') + router.refresh().
        // The soft navigation left the sign-out looking like it did nothing for
        // some accounts: @supabase/auth-helpers manages the auth cookies, and a
        // client-side refresh can race the cookie clear (and, on a protected
        // route, be re-hydrated by the middleware's getUser refresh) so the
        // server shell re-renders still signed in. A hard load to '/' makes the
        // server process the cleared cookies exactly once, for every account
        // type and whatever page they logged out from.
        window.location.assign('/');
    }

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <li className='hover:bg-slate-200 rounded-md p-2 cursor-pointer'>
                    Logout
                </li>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Log out of Galloway Getaways?</AlertDialogTitle>
                    <AlertDialogDescription>
                        You&apos;ll be signed out on this device. You can sign back in at any time.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={logout} disabled={loading}>
                        {loading ? 'Signing out...' : 'Log out'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export default SignOut
