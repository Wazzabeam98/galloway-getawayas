'use client';

import { useEffect, useState } from 'react';
import HostReplyBox from '@/components/HostReplyBox';

// A review's host reply, decided per viewer on the client so the listing page's
// HTML stays the same for everyone (and can be edge-cached). By default — and in
// the server HTML — it shows the read-only reply (or nothing). After load it asks
// once whether this viewer is the listing's host; if so, it swaps in the editable
// reply box. The listing page used to compute this server-side (isHostViewing),
// which needed the session and made every listing page render per-request.
//
// One fetch per listing: all the ReviewReply instances on a page share the
// promise, keyed by listing id.

const hostCheck = new Map<string, Promise<boolean>>();

function isHostOf(listingId: string): Promise<boolean> {
    let p = hostCheck.get(listingId);
    if (!p) {
        p = fetch(`/api/listings/${listingId}/relationship`, { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : { isHost: false }))
            .then((d) => d?.isHost === true)
            .catch(() => false);
        hostCheck.set(listingId, p);
    }
    return p;
}

export default function ReviewReply({
    listingId,
    reviewId,
    existingReply,
}: {
    listingId: string;
    reviewId: string;
    existingReply: string | null;
}) {
    const [isHost, setIsHost] = useState(false);

    useEffect(() => {
        let live = true;
        isHostOf(listingId).then((v) => { if (live) setIsHost(v); });
        return () => { live = false; };
    }, [listingId]);

    if (isHost) return <HostReplyBox reviewId={reviewId} existingReply={existingReply} />;

    if (existingReply) {
        return (
            <div className="mt-3 ml-4 pl-4 border-l-2 border-slate-200">
                <p className="text-xs font-semibold text-slate-500 mb-1">Response from the host</p>
                <p className="text-sm text-slate-700">{existingReply}</p>
            </div>
        );
    }
    return null;
}
