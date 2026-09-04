'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import LoginModel from '@/components/auth/LoginModel';
import SignupModel from '@/components/auth/SignupModel';

// Someone joining a trip is often doing it on a phone, from an email, having
// never used the site before — so each case is said plainly, and crucially the
// sign-in happens HERE. Password sign-in reloads this page and Google/sign-up
// carry a return path (see SignupModel/GoogleButton), so a friend lands back on
// the invite to accept, not on the home page wondering what happened.
export default function AcceptTripInvite({
    token,
    inviteEmail,
    signedInAs,
}: {
    token: string;
    inviteEmail: string;
    signedInAs: string;
}) {
    const [working, setWorking] = useState(false);
    const [done, setDone] = useState(false);

    // An email-bound invite must be accepted from that address; a plain share
    // link has no address to match, so anyone signed in can accept.
    const emailBound = !!(inviteEmail && inviteEmail.trim());
    const matches =
        !emailBound ||
        (signedInAs && signedInAs.toLowerCase() === inviteEmail.toLowerCase());

    const accept = async () => {
        setWorking(true);
        try {
            const res = await fetch('/api/booking-guests/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: token }),
            });
            const data = await res.json();

            if (data && data.ok) {
                toast.success('You’re on the trip.', { theme: 'colored' });
                setDone(true);
                return;
            }

            toast.error((data && data.error) || 'Could not accept this invitation.', {
                theme: 'colored',
            });
        } catch (err) {
            toast.error('Could not accept this invitation.', { theme: 'colored' });
        }
        setWorking(false);
    };

    // Joined — give them somewhere obvious to go next rather than dropping them
    // on a bare list. This is the warmest lead the site gets: a friend just
    // brought them in.
    if (done) {
        return (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-sm font-semibold text-emerald-900">You&apos;re on the trip.</p>
                <p className="mt-1 text-sm text-emerald-800/90">
                    It&apos;s in your trips, with the address, the way in and a line to the host.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                    <Link href="/trips" className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800">
                        See your trip
                    </Link>
                    <Link href="/" className="rounded-xl border border-emerald-300 bg-white px-5 py-3 text-sm font-semibold text-emerald-800 hover:border-emerald-500">
                        Explore more of Galloway
                    </Link>
                </div>
            </div>
        );
    }

    if (!signedInAs) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                {emailBound ? (
                    <>
                        <p className="text-sm text-slate-700">
                            Sign in as <strong>{inviteEmail}</strong> to join this trip.
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                            New to Galloway Getaways? Create an account with that same email address —
                            <strong> {inviteEmail}</strong> — or the invite won&apos;t match. You&apos;ll come
                            straight back here to join.
                        </p>
                    </>
                ) : (
                    <>
                        <p className="text-sm text-slate-700">Sign in to join this trip.</p>
                        <p className="mt-1 text-sm text-slate-500">
                            New to Galloway Getaways? Create a free account — it takes a moment, and
                            you&apos;ll come straight back here to join.
                        </p>
                    </>
                )}
                {/* Rendered here so sign-in happens on the invite: a password
                    sign-in reloads this page, and sign-up/Google carry a return
                    path back to it. Both render as menu-item buttons (the site's
                    auth convention), so a bordered list reads as two clean
                    options. */}
                <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800">
                    <LoginModel next={'/trip-invite/' + token} />
                    <SignupModel />
                </ul>
            </div>
        );
    }

    if (!matches) {
        return (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="text-sm text-amber-900">
                    This invitation was sent to <strong>{inviteEmail}</strong>, but you&apos;re
                    signed in as <strong>{signedInAs}</strong>.
                </p>
                <p className="text-sm text-amber-800 mt-2">
                    Sign out and back in as {inviteEmail}, or ask whoever invited you to send it to{' '}
                    {signedInAs} instead.
                </p>
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={accept}
            disabled={working}
            className="px-6 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-xl disabled:opacity-50"
        >
            {working ? 'Just a moment…' : 'Accept and join the trip'}
        </button>
    );
}
