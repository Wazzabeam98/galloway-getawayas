import Link from 'next/link';

// The owner looking at their own page before it's approved — the provider twin
// of the holiday-let pending preview (app/homes/[id]/page.tsx). The same quiet
// sky bar: it says this is the real page and that nobody else can see it yet.
// Shown only on a page the server has already decided is the owner's own.
//
// An admin reviewing it (viewer="admin") gets the same bar, worded for them:
// it is somebody else's page, waiting on their decision.
export default function OwnerPreviewBanner({ status, who, backHref, backLabel, viewer = 'owner' }: {
    status: string | null | undefined;
    who: 'guests' | 'hosts';
    backHref: string;
    backLabel: string;
    viewer?: 'owner' | 'admin';
}) {
    return (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-900">
            <span>
                <span className="font-semibold">{'Preview, not yet visible to ' + who + '.'}</span>{' '}
                {viewer === 'admin'
                    ? (status === 'pending_review'
                        ? 'It’s waiting for your review — this is exactly how ' + who + ' will see it once it’s live.'
                        : status === 'declined'
                            ? 'It was sent back — this is how it looks to ' + who + ' if it’s approved.'
                            : 'It hasn’t been sent for review yet — this is how it looks to ' + who + ' if it’s approved.')
                    : status === 'pending_review'
                        ? 'It’s waiting for approval — this is how your page will look once it’s live.'
                        : 'It’s still a draft — this is how your page will look once it’s approved.'}
            </span>
            <Link href={backHref} className="font-semibold underline underline-offset-2 hover:text-sky-950">
                {backLabel}
            </Link>
        </div>
    );
}
