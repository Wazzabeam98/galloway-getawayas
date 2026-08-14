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
import { useRouter } from 'next/navigation'


const SignOut = () => {
    const supabase = createClientComponentClient();
    const router = useRouter();
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

        setLoading(false);
        router.push('/');
        router.refresh();
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
