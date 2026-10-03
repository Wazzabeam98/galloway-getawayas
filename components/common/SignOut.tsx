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
import { signOutThisDevice } from '@/lib/staySignedIn'


const SignOut = () => {
    const supabase = createClientComponentClient();
    const [loading, setLoading] = useState(false);

    const logout = async () => {
        setLoading(true);

        // This device only — never the person's other devices — and the
        // cookie goes whatever the server answers. The next sign-in on this
        // device chooses again whether to stay. See lib/staySignedIn.
        await signOutThisDevice(supabase);

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
