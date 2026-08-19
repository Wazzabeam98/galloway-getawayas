'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'react-toastify';

// Three situations, and the wrong one silently doing nothing would be worse
// than an awkward message: signed in as the right person, signed in as
// somebody else, or not signed in at all.
export default function AcceptInvite({
    token,
    inviteEmail,
    signedInAs,
}: {
    token: string;
    inviteEmail: string;
    signedInAs: string;
}) {
    const router = useRouter();
    const [working, setWorking] = useState(false);

    const matches =
        signedInAs && signedInAs.toLowerCase() === (inviteEmail || '').toLowerCase();

    const accept = async () => {
        setWorking(true);
        try {
            const res = await fetch('/api/listing-access/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: token }),
            });
            const data = await res.json();

            if (data && data.ok) {
                toast.success('You\u2019re in.', { theme: 'colored' });
                router.push('/dashboard');
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

    if (!signedInAs) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm text-slate-700 mb-4">
                    Sign in as <strong>{inviteEmail}</strong> to accept. If you don&apos;t have an
                    account yet, create one with that email address and come back to this page.
                </p>
                <Link
                    href="/"
                    className="px-5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl inline-block"
                >
                    Sign in or sign up
                </Link>
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
            {working ? 'Just a moment…' : 'Accept'}
        </button>
    );
}
