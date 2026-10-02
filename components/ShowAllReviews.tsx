'use client';

import React, { useState } from 'react';

// The reviews list, capped so the section doesn't run away with the page.
// Shows the first `initial` and reveals the rest on a press — the same button
// language the photo gallery uses ("Show all N …"), shared by the cottage and
// experience listings so the two behave the same. The review markup itself is
// passed in as children, so each listing keeps its own item shape; this only
// caps and reveals.
export default function ShowAllReviews({
    children,
    initial = 4,
    className = 'space-y-5',
}: {
    children: React.ReactNode;
    initial?: number;
    // The list container's classes, so each listing keeps its own spacing.
    className?: string;
}) {
    const items = React.Children.toArray(children);
    const [open, setOpen] = useState(false);
    const shown = open ? items : items.slice(0, initial);

    return (
        <>
            <div className={className}>{shown}</div>
            {items.length > initial && (
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    className="mt-6 inline-flex items-center rounded-lg border border-slate-900/10 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50"
                >
                    {open ? 'Show less' : `Show all ${items.length} reviews`}
                </button>
            )}
        </>
    );
}
