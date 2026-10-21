'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import NavMenu from '@/components/base/NavMenu';
import ModeSwitch from '@/components/base/ModeSwitch';
import RememberAccount from '@/components/auth/RememberAccount';
import type { HostPerms } from '@/lib/workMode';

// The navbar's per-viewer right-hand side, fetched on the client so the page's
// HTML stays the same for everyone and can be edge-cached. The SERVER renders
// this component's signed-out shell (Start hosting + the Log in menu); after the
// page loads it asks /api/nav who the viewer is and, if signed in, swaps in
// "Welcome, {name}", the mode switch and the account menu. A signed-out visitor
// sees no change — the shell is already right. See app/api/nav/route.ts and the
// note on the old server navbar.

type Nav = {
    signedIn: true;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    initial: string;
    avatarKey: string | null;
    avatarUrl: string | null;
    isAdmin: boolean;
    isHost: boolean;
    isProvider: boolean;
    providerAudience: string | null;
    ownsAny: boolean;
    isFullAccessSomewhere: boolean;
    hostPerms: HostPerms;
    providerPerms: HostPerms;
    providerFullAccess: boolean;
    hasCompletedStay: boolean;
    mode: 'host' | 'travel';
};

export default function NavUser({ experiencesOpen }: { experiencesOpen: boolean }) {
    // null = not yet known (the signed-out shell, matching the server render).
    const [nav, setNav] = useState<Nav | null>(null);

    useEffect(() => {
        let live = true;
        fetch('/api/nav', { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d && d.signedIn) setNav(d as Nav); })
            .catch(() => { /* leave the signed-out shell in place */ });
        return () => { live = false; };
    }, []);

    const signedIn = nav != null;

    return (
        <div className="flex items-center gap-3 sm:gap-6">
            {signedIn && nav.firstName && (
                <Link href="/account" className="text-sm font-semibold text-slate-800 hidden sm:block hover:underline">
                    Welcome, {nav.firstName}
                </Link>
            )}

            {signedIn && nav.isHost ? (
                <div className="hidden sm:block">
                    <ModeSwitch mode={nav.mode} />
                </div>
            ) : signedIn && nav.isProvider ? (
                // A provider (a trade or experience host) has a providing side and
                // a travelling side — the same switch, pointed at their dashboard
                // and worded "providing".
                <div className="hidden sm:block">
                    <ModeSwitch mode={nav.mode} workHref="/services/dashboard" workLabel="providing" />
                </div>
            ) : !signedIn ? (
                // Off below 360px: the logo, this and the menu need ~355px and
                // would push the page sideways. It is in the menu too.
                <Link href="/business" className="hidden min-[360px]:block text-sm font-semibold hover:bg-slate-100 rounded-full py-2 px-4 transition text-slate-800">
                    Start hosting
                </Link>
            ) : null}

            {signedIn && (
                <RememberAccount
                    firstName={nav.firstName}
                    avatarUrl={nav.avatarUrl}
                    email={nav.email ?? undefined}
                    phone={nav.phone ?? undefined}
                />
            )}

            <NavMenu
                session={signedIn ? {} : undefined}
                experiencesOpen={experiencesOpen}
                isHost={signedIn ? nav.isHost : false}
                ownsAny={signedIn ? nav.ownsAny : false}
                isFullAccessSomewhere={signedIn ? nav.isFullAccessSomewhere : false}
                hostPerms={signedIn ? nav.hostPerms : undefined}
                isAdmin={signedIn ? nav.isAdmin : false}
                mode={signedIn ? nav.mode : 'travel'}
                hasCompletedStay={signedIn ? nav.hasCompletedStay : false}
                isProvider={signedIn ? nav.isProvider : false}
                providerAudience={signedIn ? nav.providerAudience : null}
                providerPerms={signedIn ? nav.providerPerms : undefined}
                providerFullAccess={signedIn ? nav.providerFullAccess : false}
                avatarUrl={signedIn ? nav.avatarKey : null}
                initial={signedIn ? nav.initial : ''}
            />
        </div>
    );
}
