'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { EyeOff, Undo2, Pencil, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'react-toastify';

// One listing on the owner's moderation list. The reason box is the point:
// nothing here happens without one, because the whole reason this screen
// exists is that it acts on somebody else's property.
export default function AdminListingRow({
    id,
    title,
    area,
    image,
    status,
    hostName,
    isMine,
    liveBookings,
    removal,
}: {
    id: string;
    title: string;
    area: string;
    image: string | null;
    status: string;
    hostName: string;
    isMine: boolean;
    liveBookings: number;
    /**
     * What Remove will do, from lib/listingRemoval's rule: 'delete' when the
     * listing never took money, 'hide' when it has a paid booking or order.
     * The route decides again on the click; this is what the confirm says.
     */
    removal: 'delete' | 'hide';
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('');
    const [working, setWorking] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [removeReason, setRemoveReason] = useState('');
    const [removeError, setRemoveError] = useState('');

    const remove = async () => {
        setWorking(true);
        setRemoveError('');
        try {
            const res = await fetch('/api/admin/listings/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ listingId: id, reason: removeReason, expect: removal }),
            });
            const data = await res.json();
            if (!data || !data.ok) {
                // Kept in the dialog, not a toast: "a booking was paid since
                // the page loaded" is something to read before doing anything else.
                setRemoveError((data && data.error) || 'Could not remove that.');
                return;
            }
            setRemoving(false);
            setRemoveReason('');
            toast.success(
                data.outcome === 'deleted'
                    ? 'Deleted for good, with its photos.'
                    : 'Taken down. Its bookings and payments are kept.',
                { theme: 'colored' }
            );
            router.refresh();
        } catch {
            setRemoveError('Could not remove that.');
        } finally {
            setWorking(false);
        }
    };

    const hidden = status === 'hidden';
    const isDraft = status === 'draft';

    const apply = async () => {
        setWorking(true);
        const res = await fetch('/api/admin/listings/visibility', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ listingId: id, hidden: !hidden, reason }),
        });
        const data = await res.json();
        setWorking(false);

        if (!data || !data.ok) {
            toast.error((data && data.error) || 'Could not change that.', { theme: 'colored' });
            return;
        }

        setOpen(false);
        setReason('');
        toast.success(
            hidden ? 'Back on the site.' : 'Hidden. Existing bookings are untouched.',
            { theme: 'colored' }
        );
        router.refresh();
    };

    return (
        <div className="border rounded-2xl p-4 flex items-start gap-4">
            <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-200 flex-shrink-0">
                {image && <img src={image} alt="" className="w-full h-full object-cover" />}
            </div>

            <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900 truncate">{title}</div>
                <div className="text-sm text-slate-500 truncate">{area}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                    {isMine ? 'Yours' : hostName}
                    {liveBookings > 0
                        ? ' · ' + liveBookings + (liveBookings === 1 ? ' stay booked' : ' stays booked')
                        : ''}
                </div>

                <div className="flex items-center gap-3 mt-2">
                    <Link
                        href={'/homes/' + id}
                        className="text-xs font-semibold text-slate-500 underline hover:text-slate-800 inline-flex items-center gap-1"
                    >
                        <ExternalLink className="w-3 h-3" /> View
                    </Link>
                    <Link
                        href={'/edit-listing/' + id}
                        className="text-xs font-semibold text-slate-500 underline hover:text-slate-800 inline-flex items-center gap-1"
                    >
                        <Pencil className="w-3 h-3" /> Edit
                    </Link>
                </div>
            </div>

            <div className="flex-shrink-0 flex flex-col items-end gap-2">
                <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        status === 'published'
                            ? 'bg-green-100 text-green-800'
                            : status === 'hidden'
                                ? 'bg-slate-200 text-slate-700'
                                : status === 'pending_review'
                                    ? 'bg-sky-100 text-sky-900'
                                    : 'bg-amber-100 text-amber-800'
                    }`}
                >
                    {/* The column value everywhere else, but not here: an
                        owner triaging a queue should read "waiting", not the
                        database's word for it. */}
                    {status === 'pending_review' ? 'waiting' : status}
                </span>

                {/* A draft is not on the site, so there is nothing to take off it. */}
                {!isDraft && (
                    <button
                        type="button"
                        onClick={() => setOpen(true)}
                        disabled={working}
                        className={`h-8 px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 ${
                            hidden
                                ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                                : 'border border-slate-300 hover:border-slate-900 text-slate-700'
                        }`}
                    >
                        {hidden ? <Undo2 className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        {hidden ? 'Relist' : 'Hide'}
                    </button>
                )}

                {/* Already down and can only be hidden: nothing more Remove can do. */}
                {!(removal === 'hide' && hidden) && (
                    <button
                        type="button"
                        onClick={() => { setRemoving(true); setRemoveReason(''); setRemoveError(''); }}
                        disabled={working}
                        className="h-8 px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 border border-red-200 text-red-700 hover:border-red-700 disabled:opacity-50"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove
                    </button>
                )}
            </div>

            {open && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
                    onClick={() => !working && setOpen(false)}
                >
                    <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
                        <h3 className="font-bold text-slate-900 mb-2">
                            {hidden ? 'Put ' : 'Hide '}{title}{hidden ? ' back on the site?' : '?'}
                        </h3>

                        {!isMine && (
                            <p className="text-sm text-slate-600 mb-3">
                                This belongs to {hostName}. They are not told automatically.
                            </p>
                        )}

                        {!hidden && liveBookings > 0 && (
                            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                                {liveBookings === 1
                                    ? 'There is 1 stay already booked on this listing.'
                                    : 'There are ' + liveBookings + ' stays already booked on this listing.'}
                                {' '}Hiding does not cancel them — the guests keep their stay and the
                                host still has to host them.
                            </p>
                        )}

                        <label className="text-xs font-semibold text-slate-700">
                            Why? This is recorded against your name.
                        </label>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            autoFocus
                            placeholder="e.g. Photo four shows the neighbouring property's front door"
                            className="w-full p-2.5 border rounded-lg text-sm mt-1 mb-4"
                        />

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={apply}
                                disabled={working || reason.trim().length < 3}
                                className="px-4 py-2 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-xl disabled:opacity-40"
                            >
                                {working ? 'Saving…' : hidden ? 'Put it back' : 'Hide it'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                disabled={working}
                                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {removing && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
                    onClick={() => !working && setRemoving(false)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={'remove-' + id}
                        className="bg-white rounded-2xl p-6 max-w-md w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 id={'remove-' + id} className="font-bold text-slate-900 mb-2">
                            {removal === 'delete' ? 'Delete ' + title + ' for good?' : 'Take ' + title + ' down?'}
                        </h3>

                        {removal === 'delete' ? (
                            <p className="text-sm text-slate-600 mb-3">
                                It has never taken a booking, so it will be deleted completely, with its
                                photos. This can&rsquo;t be undone.
                                {!isMine && ` ${hostName} is not told automatically.`}
                            </p>
                        ) : (
                            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                                This listing has bookings, so it can&rsquo;t be deleted &mdash; the booking and
                                payment records have to be kept. It will be taken off the site instead, the
                                same as Hide. Guests who have booked keep their stay.
                            </p>
                        )}

                        <label htmlFor={'remove-reason-' + id} className="text-xs font-semibold text-slate-700">
                            Why? This is recorded against your name.
                        </label>
                        <textarea
                            id={'remove-reason-' + id}
                            value={removeReason}
                            onChange={(e) => setRemoveReason(e.target.value)}
                            rows={3}
                            autoFocus
                            placeholder="e.g. Test listing, never real"
                            className="w-full p-2.5 border rounded-lg text-sm mt-1 mb-3"
                        />

                        {removeError && <p className="text-sm text-red-700 mb-3">{removeError}</p>}

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={remove}
                                disabled={working || removeReason.trim().length < 3}
                                className={`px-4 py-2 text-white text-sm font-semibold rounded-xl disabled:opacity-40 ${
                                    removal === 'delete' ? 'bg-red-700 hover:bg-red-800' : 'bg-slate-900 hover:bg-black'
                                }`}
                            >
                                {working ? 'Working…' : removal === 'delete' ? 'Delete for good' : 'Take it down'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setRemoving(false)}
                                disabled={working}
                                className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
