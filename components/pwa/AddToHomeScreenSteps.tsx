// How to add the site to an iPhone's Home Screen, with Safari's own icons drawn
// in, so it's clear what to tap: the Share button (a box with an arrow coming
// out of the top), then "Add to Home Screen" (a box with a plus).

function ShareIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="inline-block align-[-3px] text-sky-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2" />
            <path d="M12 3v12" />
            <path d="M8.5 6.5 12 3l3.5 3.5" />
        </svg>
    );
}

function AddIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="inline-block align-[-3px] text-slate-700" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="3" />
            <path d="M12 8v8M8 12h8" />
        </svg>
    );
}

export default function AddToHomeScreenSteps() {
    return (
        <ol className="space-y-1.5 text-slate-700">
            <li>
                1. Tap <ShareIcon /> <span className="font-semibold">Share</span> in Safari&rsquo;s toolbar.
            </li>
            <li>
                2. Scroll down and tap <AddIcon /> <span className="font-semibold">Add to Home Screen</span>.
            </li>
        </ol>
    );
}
