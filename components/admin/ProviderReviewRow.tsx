'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';

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
}: {
    provider: any;
    areas: string[];
    photoUrls: string[];
    // Gas Safe, OFTEC or a Part P scheme, where the trade needs one. Empty for
    // the trades that need none, which is most of them.
    registrations?: any[];
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

    const pending = provider.status === 'pending_review';
    const regs: any[] = registrations || [];
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
                <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_STYLE[provider.status] || STATUS_STYLE.draft}`}>
                    {STATUS_LABEL[provider.status] || provider.status}
                </span>
            </div>

            {provider.description && (
                <p className="text-sm text-slate-700 mt-3 whitespace-pre-line">{provider.description}</p>
            )}

            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm mt-4">
                <div className="flex gap-2">
                    <dt className="text-slate-500 shrink-0">Covers</dt>
                    <dd className="text-slate-900">{areas.length ? areas.join(', ') : <span className="text-rose-700">nowhere</span>}</dd>
                </div>
                <div className="flex gap-2">
                    <dt className="text-slate-500 shrink-0">Contact</dt>
                    <dd className="text-slate-900 truncate">{provider.contact_email}{provider.contact_phone ? ' · ' + provider.contact_phone : ''}</dd>
                </div>
            </dl>

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
