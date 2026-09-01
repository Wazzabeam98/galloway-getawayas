'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { planForTrade, bandLabel, SUBSCRIPTION_MONTHLY, TRIAL_DAYS } from '@/lib/serviceProviders';
import { ASSIGNABLE_MCCS, assignableMccLabel } from '@/lib/serviceOrders';

const STATUS_STYLE: Record<string, string> = {
    pending_review: 'bg-amber-50 text-amber-900 border-amber-200',
    approved: 'bg-emerald-50 text-emerald-900 border-emerald-200',
    declined: 'bg-rose-50 text-rose-900 border-rose-200',
    draft: 'bg-slate-100 text-slate-700 border-slate-200',
    hidden: 'bg-slate-100 text-slate-700 border-slate-200',
};

const STATUS_LABEL: Record<string, string> = {
    pending_review: 'Waiting',
    approved: 'Live',
    declined: 'Declined',
    draft: 'Draft, not sent',
    hidden: 'Hidden',
};

export default function ProviderReviewRow({
    provider,
    areas,
    photoUrls,
    registrations,
    blockers,
    skills,
    emailVerified,
}: {
    provider: any;
    areas: string[];
    photoUrls: string[];
    // Whether the applicant has opened the confirmation link on their SIGN-IN
    // address. null means we could not find out, which is said as such rather
    // than shown as either answer.
    emailVerified?: boolean | null;
    // Gas Safe, OFTEC or a Part P scheme, where the trade needs one. Empty for
    // the trades that need none, which is most of them.
    registrations?: any[];
    // Free-text tags. `public` is worked out from the registrations rather
    // than stored, so a tag goes private the moment its number is edited.
    skills?: any[];
    // Why this cannot be approved yet, in words. Worked out on the server from
    // the same function the decision route refuses on, so the button being
    // disabled and the route saying no can never disagree.
    blockers?: string[];
}) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [expiry, setExpiry] = useState<Record<string, string>>({});
    const [decliningOpen, setDecliningOpen] = useState(false);
    const [note, setNote] = useState('');

    // Whether a turned-down set of changes also comes off the site. Some
    // edits are worth a word; some cannot stay up. Asked rather than assumed.
    const [hide, setHide] = useState(false);
    const [kindOpen, setKindOpen] = useState(false);

    // Assigning a payout category to a guest business. Prefilled from whatever
    // is already on the row, so re-assigning starts from the current answer
    // rather than blank.
    const [mcc, setMcc] = useState<string>(provider.stripe_mcc || '');
    const [customLabel, setCustomLabel] = useState<string>(provider.custom_label || '');
    // Whether they hold a cottage-date exclusively (a chef, a masseur) — one
    // live order per date. Off for a baker, who can make many.
    const [exclusive, setExclusive] = useState<boolean>(!!provider.exclusive_per_date);

    const decide = async (decision: 'approve' | 'decline' | 'approve_changes' | 'decline_changes') => {
        if ((decision === 'decline' || decision === 'decline_changes') && !note.trim()) {
            toast.error('Say why — it goes to them in the email.', { theme: 'colored' });
            return;
        }

        setBusy(true);

        const res = await fetch('/api/admin/providers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: provider.id, decision, note: note.trim(), hide }),
        });

        setBusy(false);

        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
            toast.error(body.error || 'That did not save.', { theme: 'colored' });
            return;
        }

        // The decision is saved either way. But the business only knows about
        // it if the email went, so saying nothing about a send that failed
        // would leave them waiting on a decision that has already been made.
        if (body.emailed === false) {
            toast.warning(
                (decision.indexOf('approve') === 0 ? 'Approved' : 'Declined')
                    + ', but the email did not send — tell them yourself.',
                { theme: 'colored', autoClose: false }
            );
        } else {
            toast.success(decision.indexOf('approve') === 0 ? 'Approved.' : 'Declined.', { theme: 'colored' });
        }

        setDecliningOpen(false);
        router.refresh();
    };

    // Marking a registration number as checked.
    //
    // A separate call rather than part of the approval, because it is a
    // separate act: looking a number up on the Gas Safe register happens in
    // another tab, minutes before the decision, and might well end in a
    // decline instead. Recording what was checked is worth doing either way.
    const verify = async (scheme: string) => {
        setBusy(true);

        const res = await fetch('/api/admin/providers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: provider.id,
                decision: 'verify_registration',
                scheme: scheme,
                expires_at: expiry[scheme] || null,
            }),
        });

        setBusy(false);

        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
            toast.error(body.error || 'That did not save.', { theme: 'colored' });
            return;
        }

        toast.success('Checked.', { theme: 'colored' });
        router.refresh();
    };

    // Whose business this is.
    //
    // `kind` decides whether the cleaner may be paid by the hour and whether
    // commission is taken at all, and until now the only way to set it was to
    // edit the row in production by hand — no check on who did it and no
    // record that it happened.
    //
    // A confirm step rather than a bare toggle, because flipping an hourly
    // cleaner back to external moves her onto the banded model, and the route
    // refuses outright if she has no band prices to land on.
    const setKind = async (toInHouse: boolean) => {
        setBusy(true);

        const res = await fetch('/api/admin/providers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: provider.id,
                decision: toInHouse ? 'make_in_house' : 'make_external',
            }),
        });

        setBusy(false);

        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
            // Long-lived, because the refusal explains what to do next and a
            // toast that vanishes in four seconds would not have been read.
            toast.error(body.error || 'That did not save.', { theme: 'colored', autoClose: false });
            return;
        }

        if (body.hourlyCleared) {
            toast.warning(
                'Moved to external, and her hourly rate has been cleared — she is on her '
                    + 'per-house-size prices now.',
                { theme: 'colored', autoClose: false }
            );
        } else {
            toast.success(toInHouse ? 'Marked in-house.' : 'Marked external.', { theme: 'colored' });
        }

        setKindOpen(false);
        router.refresh();
    };

    // Assigning the Stripe category, and the word a guest reads, to a "something
    // else" business. Two things in one act: the code the account onboards with
    // (never shown to a guest) and the word above them on the shop (always
    // shown). Both are required, and the route refuses without either — the
    // button below refuses too, as a courtesy.
    const assignCategory = async () => {
        if (!mcc) { toast.error('Pick a category.', { theme: 'colored' }); return; }
        if (!customLabel.trim()) { toast.error('Type the word a guest will read.', { theme: 'colored' }); return; }

        setBusy(true);

        const res = await fetch('/api/admin/providers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: provider.id,
                decision: 'assign_category',
                mcc,
                custom_label: customLabel.trim(),
                exclusive_per_date: exclusive,
            }),
        });

        setBusy(false);

        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
            toast.error(body.error || 'That did not save.', { theme: 'colored' });
            return;
        }

        toast.success('Category set.', { theme: 'colored' });
        router.refresh();
    };

    const pending = provider.status === 'pending_review';
    const regs: any[] = registrations || [];
    const tags: any[] = skills || [];
    const hiddenTags = tags.filter((t) => !t.public);
    const stops: string[] = blockers || [];

    // Set by the page, and only for the group that has edits outstanding.
    const changed: string[] = provider.changedFields || [];
    const hasChanges = changed.length > 0;

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex items-start gap-3">
                    {/* A logo where they have one, initials where they have
                        not — the same stand-in the account avatars use, so a
                        firm without one does not look broken. */}
                    <div className="w-11 h-11 shrink-0 rounded-full overflow-hidden bg-slate-900 text-white flex items-center justify-center text-sm font-semibold">
                        {provider.logoUrl
                            ? <img src={provider.logoUrl} alt="" className="w-full h-full object-cover" />
                            : provider.initials}
                    </div>
                    <div className="min-w-0">
                    <h3 className="font-bold text-slate-900">{provider.business_name}</h3>
                    <p className="text-sm text-slate-600 mt-0.5">
                        {provider.tradeLabel}
                        {' · '}
                        {provider.audience === 'both' ? 'guests and owners' : provider.audience === 'guest' ? 'guests' : 'owners'}
                        {provider.kind === 'in_house' ? ' · in-house' : ''}
                    </p>
                    </div>
                </div>
                <div className="shrink-0 flex flex-wrap items-center gap-2 justify-end">
                    {/* An application is lodged before anybody opens their
                        inbox — that is the point, it is what stops applications
                        being lost — so some of these people have not confirmed
                        their address yet. Worth knowing before approving, since
                        approving sends them an email.

                        Deliberately NOT a blocker. It says what is true and
                        leaves the decision alone. */}
                    {emailVerified === false && (
                        <span
                            title="They have not opened the confirmation link on their sign-in address yet. This says nothing about the contact address below, which is never verified."
                            className="text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-900"
                        >
                            Email unconfirmed
                        </span>
                    )}
                    {emailVerified === null && (
                        <span
                            title="We could not read the account's confirmation state just now. It is not a claim either way."
                            className="text-xs font-semibold px-2.5 py-1 rounded-full border border-slate-300 bg-slate-50 text-slate-600"
                        >
                            Email state unknown
                        </span>
                    )}
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_STYLE[provider.status] || STATUS_STYLE.draft}`}>
                        {STATUS_LABEL[provider.status] || provider.status}
                    </span>
                </div>
            </div>

            {provider.description && (
                <p className="text-sm text-slate-700 mt-3 whitespace-pre-line">{provider.description}</p>
            )}

            {/* Every guest business is categorised here — nobody picks a category
                any more, so you read what they described above and assign it:
                the Stripe code the account onboards with, the word a guest reads
                on the shop, and whether they hold a date exclusively. Until the
                code and the word are both set, a blocker holds Approve — they
                cannot reach Stripe onboarding, and a guest could never be paid. */}
            {provider.audience === 'guest' && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Guest category
                    </h4>
                    <p className="text-sm text-slate-500 mb-3">
                        Read what they wrote and set this from it.
                        {provider.category_assigned_at ? '' : ' Nothing goes live, and they cannot set up payouts, until you do.'}
                    </p>

                    {provider.custom_label && provider.stripe_mcc && (
                        <p className="text-sm text-slate-700 mb-3">
                            Guests see <strong className="font-semibold">{provider.custom_label}</strong>
                            {' · '}Stripe category <strong className="font-semibold">{provider.stripe_mcc}</strong>
                            <span className="text-slate-500"> ({assignableMccLabel(provider.stripe_mcc)})</span>
                            {provider.exclusive_per_date ? <span className="text-slate-500"> · holds a date exclusively</span> : null}
                        </p>
                    )}

                    <label className="block text-sm font-semibold text-slate-900 mb-1">
                        What a guest reads
                    </label>
                    <input
                        type="text"
                        value={customLabel}
                        onChange={(e) => setCustomLabel(e.target.value)}
                        placeholder="Private chef, Cakes & baking, Wild swimming…"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />

                    <label className="block text-sm font-semibold text-slate-900 mb-1">
                        Stripe category
                    </label>
                    <select
                        value={mcc}
                        onChange={(e) => setMcc(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm mb-3 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    >
                        <option value="">Choose a category…</option>
                        {ASSIGNABLE_MCCS.map((m) => (
                            <option key={m.code} value={m.code}>{m.label} ({m.code})</option>
                        ))}
                    </select>

                    <label className="flex items-start gap-2 text-sm text-slate-700 mb-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={exclusive}
                            onChange={(e) => setExclusive(e.target.checked)}
                            className="mt-0.5"
                        />
                        <span>
                            <span className="font-semibold text-slate-900">Holds a date exclusively</span>
                            <span className="block text-slate-500">
                                One booking per cottage-date — a chef or a masseur cannot be in two
                                places at once. Leave off for a baker or hamper maker, who can fulfil
                                several on a date.
                            </span>
                        </span>
                    </label>

                    <button
                        type="button"
                        onClick={assignCategory}
                        disabled={busy}
                        className="rounded-full bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-60"
                    >
                        {busy ? 'Saving…' : provider.category_assigned_at ? 'Change category' : 'Assign category'}
                    </button>
                </div>
            )}

            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm mt-4">
                {/* Worded by lib/serviceProviders.ts calloutLine, so this and
                    the directory cannot say it differently. Absent rather than
                    "none" when there is no fee: not charging one and not having
                    said are different, and only one is ours to announce. */}
                {provider.calloutLine && (
                    <div className="flex gap-2">
                        <dt className="text-slate-500 shrink-0">Call-out</dt>
                        <dd className="text-slate-900">
                            {provider.calloutLine}
                            {provider.hourly_rate ? ' · £' + provider.hourly_rate + ' an hour' : ''}
                        </dd>
                    </div>
                )}
                {/* What they pay. Shown on the card the decision is made
                    from, because approving is what starts the free period —
                    and an owner should be able to see, before they click,
                    which of the two things they are about to agree to. */}
                {/* An hourly cleaner has no call-out line and no band
                    prices, so without this the card would say nothing at all
                    about what she charges — and this is the card the decision
                    is made from. In-house only, so it is rare by design and
                    worth spelling out when it appears. */}
                {provider.pricing_choice === 'hourly' && (
                    <div className="flex gap-2">
                        <dt className="text-slate-500 shrink-0">Charges</dt>
                        <dd className="text-slate-900">
                            {provider.billable_hourly_rate
                                ? '£' + provider.billable_hourly_rate + ' an hour'
                                : <span className="text-rose-700">hourly, no rate set</span>}
                            <span className="text-slate-500">
                                {' · '}
                                {Array.isArray(provider.covered_bands) && provider.covered_bands.length > 0
                                    ? provider.covered_bands.map(bandLabel).join(', ')
                                    : 'no sizes ticked, so she appears nowhere'}
                            </span>
                        </dd>
                    </div>
                )}

                <div className="flex gap-2">
                    <dt className="text-slate-500 shrink-0">Whose</dt>
                    <dd className="text-slate-900">
                        {provider.kind === 'in_house' ? 'Ours, in-house' : 'Theirs'}
                        <button
                            type="button"
                            onClick={() => setKindOpen(!kindOpen)}
                            className="ml-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800 underline"
                        >
                            change
                        </button>

                        {kindOpen && (
                            <span className="block mt-2 rounded-xl border border-slate-300 bg-slate-50 p-3">
                                <span className="block text-sm text-slate-700 mb-2.5">
                                    {provider.kind === 'in_house'
                                        ? 'Make this somebody else\u2019s business? They will be charged commission, and cannot be paid by the hour.'
                                        : 'Make this ours? No commission is taken, and a cleaner can then be paid by the hour.'}
                                </span>

                                <span className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => setKind(provider.kind !== 'in_house')}
                                        className="rounded-full bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-sm font-semibold transition disabled:opacity-60"
                                    >
                                        {provider.kind === 'in_house' ? 'Mark external' : 'Mark in-house'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setKindOpen(false)}
                                        className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                                    >
                                        Leave it
                                    </button>
                                </span>
                            </span>
                        )}
                    </dd>
                </div>

                <div className="flex gap-2">
                    <dt className="text-slate-500 shrink-0">Pays</dt>
                    <dd className="text-slate-900">
                        {/* From the trade, not from the column. A row that
                            has not been approved yet is carrying the column
                            default, which for a plumber says the wrong thing.
                            Approval stamps the same value this computes, so
                            the two never disagree once it is live. */}
                        {planForTrade(provider.trade) === 'subscription' ? (
                            <>
                                &pound;{SUBSCRIPTION_MONTHLY} a month
                                {provider.trial_ends_at ? (
                                    <span className="text-slate-500">
                                        {' '}&middot; free until{' '}
                                        {new Date(provider.trial_ends_at).toLocaleDateString('en-GB', {
                                            day: 'numeric', month: 'short', year: 'numeric',
                                        })}
                                    </span>
                                ) : (
                                    <span className="text-slate-500"> &middot; {TRIAL_DAYS} free days start on approval</span>
                                )}
                            </>
                        ) : (
                            <>10% a job</>
                        )}
                    </dd>
                </div>
                <div className="flex gap-2">
                    <dt className="text-slate-500 shrink-0">Covers</dt>
                    <dd className="text-slate-900">{areas.length ? areas.join(', ') : <span className="text-rose-700">nowhere</span>}</dd>
                </div>
                <div className="flex gap-2">
                    <dt className="text-slate-500 shrink-0">Contact</dt>
                    <dd className="text-slate-900 truncate">{provider.contact_email}{provider.contact_phone ? ' · ' + provider.contact_phone : ''}</dd>
                </div>
            </dl>

            {/* The caveat, said where the address is rather than only in the
                badge at the top. Two different addresses are in play and it is
                easy to read the badge as covering both: the badge is about the
                account they sign in with, and THIS is the one every decision
                email goes to. Nothing verifies this one, ever — a typo here
                bounces the approval into nowhere whatever the badge says. */}
            {emailVerified === false && (
                <p className="mt-2 text-xs text-amber-800">
                    Unconfirmed refers to their sign-in address. The contact address above is a
                    separate field and is never verified — decisions are emailed to it either way.
                </p>
            )}

            {tags.length > 0 && (
                <div className="mt-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                        Skills
                    </h4>
                    <div className="flex flex-wrap gap-2">
                        {tags.map((tag: any) => (
                            <span
                                key={tag.id}
                                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${
                                    tag.public
                                        ? 'border border-slate-300 bg-slate-50 text-slate-900'
                                        : 'border border-amber-300 bg-amber-50 text-amber-900'
                                }`}
                                title={tag.public ? undefined : tag.reason}
                            >
                                {tag.label}
                                {!tag.public && <span className="text-xs font-semibold">not shown</span>}
                            </span>
                        ))}
                    </div>

                    {/* Never an accusation. Most of these are somebody who
                        does the work and has not given us their number yet. */}
                    {hiddenTags.length > 0 && (
                        <p className="text-sm text-amber-900 mt-2">
                            {hiddenTags[0].reason}
                        </p>
                    )}
                </div>
            )}

            {(regs.length > 0 || provider.does_gas || provider.does_oil || stops.length > 0) && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                        Registration
                    </h4>

                    {(provider.does_gas || provider.does_oil) && (
                        <p className="text-sm text-slate-700 mb-3">
                            Says they do{' '}
                            {[provider.does_gas ? 'gas' : '', provider.does_oil ? 'oil' : '']
                                .filter(Boolean).join(' and ')}
                            {' '}work.
                        </p>
                    )}

                    {regs.length === 0 && (
                        <p className="text-sm text-slate-500">Nothing given.</p>
                    )}

                    <div className="space-y-3">
                        {regs.map((r: any) => (
                            <div key={r.scheme} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                <span className="text-sm font-semibold text-slate-900">{r.schemeLabel}</span>
                                {/* Selectable, not just readable: the whole
                                    point is copying it into the register's own
                                    search box in the next tab. */}
                                <code className="text-sm bg-white border border-slate-200 rounded px-2 py-0.5 select-all">
                                    {r.number}
                                </code>

                                {r.verified ? (
                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                        r.expired
                                            ? 'bg-rose-100 text-rose-900'
                                            : 'bg-emerald-100 text-emerald-900'
                                    }`}>
                                        {r.expired
                                            ? 'Checked, but expired ' + r.expires_at
                                            : 'Checked' + (r.expires_at ? ', good to ' + r.expires_at : '')}
                                    </span>
                                ) : (
                                    <span className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                                            Not checked
                                        </span>
                                        <input
                                            type="date"
                                            value={expiry[r.scheme] || ''}
                                            onChange={(e) => setExpiry({ ...expiry, [r.scheme]: e.target.value })}
                                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                                            aria-label="Runs out"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => verify(r.scheme)}
                                            disabled={busy}
                                            className="rounded-full bg-slate-900 hover:bg-slate-800 text-white px-3 py-1 text-xs font-semibold transition disabled:opacity-60"
                                        >
                                            I have checked this
                                        </button>
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>

                    {stops.length > 0 && (
                        <ul className="mt-3 text-sm text-rose-800 list-disc list-inside">
                            {stops.map((b) => <li key={b}>{b}</li>)}
                        </ul>
                    )}
                </div>
            )}

            {photoUrls.length > 0 && (
                <div className="flex gap-2 mt-4">
                    {photoUrls.map((u) => (
                        <img key={u} src={u} alt="" className="w-24 h-20 object-cover rounded-lg bg-slate-100" />
                    ))}
                </div>
            )}

            {hasChanges && (
                <div className="mt-5 pt-4 border-t border-slate-200">
                    <p className="text-sm text-slate-700 mb-3">
                        Live, and has changed{' '}
                        <strong className="font-semibold text-slate-900">{changed.join(', ')}</strong>
                        {' '}since you last looked. The new version is what is on the site now.
                    </p>

                    {!decliningOpen ? (
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={() => decide('approve_changes')}
                                disabled={busy}
                                className="rounded-full bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 text-sm font-semibold transition disabled:opacity-60"
                            >
                                {busy ? 'Saving…' : 'These are fine'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setDecliningOpen(true)}
                                disabled={busy}
                                className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-500 transition"
                            >
                                Turn these down
                            </button>
                        </div>
                    ) : (
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                                What is wrong with them? They will see this.
                            </label>
                            <textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={3}
                                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                placeholder="The new description says you do wedding catering, which is not what we listed you for."
                            />

                            <label className="flex items-start gap-2.5 mt-3 text-sm text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={hide}
                                    onChange={(e) => setHide(e.target.checked)}
                                    className="mt-0.5 w-4 h-4 rounded border-slate-300"
                                />
                                <span>
                                    Take them off the site until they fix it.
                                    <span className="block text-slate-500">
                                        Leave this unticked to let the listing stand while they sort it out.
                                    </span>
                                </span>
                            </label>

                            <div className="flex gap-3 mt-3">
                                <button
                                    type="button"
                                    onClick={() => decide('decline_changes')}
                                    disabled={busy}
                                    className="rounded-full bg-rose-700 hover:bg-rose-800 text-white px-5 py-2.5 text-sm font-semibold transition disabled:opacity-60"
                                >
                                    {busy ? 'Saving…' : hide ? 'Turn down and hide' : 'Turn down'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDecliningOpen(false)}
                                    className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {pending && (
                <div className="mt-5 pt-4 border-t border-slate-200">
                    {/* Said again, here, at the moment of deciding.
                        The badge is at the top of the row and this button is at
                        the bottom of it — on a long application the two are not
                        on screen together, and the one that matters is the one
                        you can see when you press.

                        Approving emails them, so an address nobody has proved
                        can receive email is worth knowing about first. It does
                        NOT disable anything: it is a fact, not a blocker, and
                        the decision stays the admin's. */}
                    {emailVerified === false && !decliningOpen && (
                        <p className="mb-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
                            <strong className="font-semibold">They have not confirmed their sign-in address.</strong>{' '}
                            Approving sends an email to <strong className="font-semibold">{provider.contact_email}</strong> —
                            a different address, and one nothing verifies either way.
                        </p>
                    )}
                    {!decliningOpen ? (
                        <div className="flex flex-wrap gap-3">
                            {/* Disabled rather than hidden, so the reason
                                underneath has something to be about. The route
                                refuses as well — this is the courtesy, not the
                                control. */}
                            <button
                                type="button"
                                onClick={() => decide('approve')}
                                disabled={busy || stops.length > 0}
                                title={stops.length > 0 ? stops.join(' ') : undefined}
                                className="rounded-full bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 text-sm font-semibold transition disabled:opacity-60"
                            >
                                {busy ? 'Saving…' : 'Approve'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setDecliningOpen(true)}
                                disabled={busy}
                                className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-500 transition"
                            >
                                Decline
                            </button>
                        </div>
                    ) : (
                        <div>
                            <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                                Why? They will see this.
                            </label>
                            <textarea
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                rows={3}
                                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-700"
                                placeholder="We need a bit more detail about what you offer before we can list you."
                            />
                            <div className="flex gap-3 mt-3">
                                <button
                                    type="button"
                                    onClick={() => decide('decline')}
                                    disabled={busy}
                                    className="rounded-full bg-rose-700 hover:bg-rose-800 text-white px-5 py-2.5 text-sm font-semibold transition disabled:opacity-60"
                                >
                                    {busy ? 'Saving…' : 'Send decline'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDecliningOpen(false)}
                                    className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
