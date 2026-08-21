"use client"

import React from 'react'
import { useRouter } from 'next/navigation'

// Remembers whether you're browsing as a host or as a traveller.
// Stored in a cookie so the server-rendered navbar can read it too —
// localStorage isn't visible to the server, so it can't be used here.
export function setMode(mode: 'host' | 'travel') {
    document.cookie = `gg_mode=${mode}; path=/; max-age=31536000; samesite=lax`;
}

const ModeSwitch = ({
    mode,
    className = '',
}: {
    mode: 'host' | 'travel';
    className?: string;
}) => {
    const router = useRouter();

    // Switching to hosting sends you to your listings; switching back to
    // travelling sends you to the homepage, same as Airbnb.
    const goHost = () => {
        setMode('host');
        router.push('/dashboard');
        router.refresh();
    };

    const goTravel = () => {
        setMode('travel');
        router.push('/');
        router.refresh();
    };

    // Focus is shown for keyboard use only. Clicking this with a mouse left the
    // browser's own outline sitting on it, and because the button keeps its
    // place in the menu, the outline was still there the next time the menu was
    // opened. :focus-visible means a click leaves nothing behind while tabbing
    // to it still shows where you are — the same green ring the rest of the
    // site's controls use, rather than the browser's blue one.
    const focusClass =
        'outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

    return (
        <button
            type="button"
            onClick={mode === 'host' ? goTravel : goHost}
            className={`${focusClass} ${className || 'text-sm font-semibold hover:bg-slate-100 rounded-full py-2 px-4 transition text-slate-800'}`}
        >
            {mode === 'host' ? 'Switch to travelling' : 'Switch to hosting'}
        </button>
    );
};

export default ModeSwitch;
