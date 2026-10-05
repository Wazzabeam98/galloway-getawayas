'use client';

import { useState } from 'react';
import { Flag, X } from 'lucide-react';
import { toast } from 'react-toastify';
import { reasonsFor, REPORT_DETAILS_MAX, reasonLabel, type ReportReasonKey } from '@/lib/listingReports';

// "Report this listing" — the guest-facing half of the report flow, mirroring
// Airbnb's: a muted flag link at the foot of the listing that opens a modal,
// reason first, then a line of detail, then a thank-you. The reason screen says
// plainly that the report is not shared with the host.
//
// Signed in or not, anyone looking at a listing can report it — the route
// allows it anonymously, so there is no sign-in wall here.

type Step = 'reason' | 'detail' | 'done';

// The same report flow serves a cottage listing, a guest experience and a trade
// profile. A cottage keeps calling it with `listingId` (unchanged); an experience
// or trade passes `targetType` + `targetId` (the service_providers id). The form,
// the copy, the admin queue and the placement are the same for all three.
export default function ReportListing({
    listingId,
    targetType,
    targetId,
    title,
}: {
    listingId?: string;
    targetType?: 'listing' | 'experience' | 'trade';
    targetId?: string;
    title?: string;
}) {
    const type: 'listing' | 'experience' | 'trade' = targetType || 'listing';
    const id = targetId || listingId || '';
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<Step>('reason');
    const [reason, setReason] = useState<ReportReasonKey | ''>('');
    const [details, setDetails] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const close = () => {
        if (submitting) return;
        setOpen(false);
        // Reset after the modal has gone, so it reopens fresh next time.
        setTimeout(() => {
            setStep('reason');
            setReason('');
            setDetails('');
        }, 150);
    };

    const submit = async () => {
        if (!reason || !details.trim()) return;
        setSubmitting(true);
        try {
            const res = await fetch('/api/listings/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetType: type, targetId: id, reason, details: details.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!data || !data.ok) {
                toast.error((data && data.error) || 'Could not send your report.', { theme: 'colored' });
                setSubmitting(false);
                return;
            }
            setSubmitting(false);
            setStep('done');
        } catch {
            toast.error('Could not send your report.', { theme: 'colored' });
            setSubmitting(false);
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 underline underline-offset-4 hover:text-slate-800"
            >
                <Flag className="w-4 h-4" />
                Report this listing
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
                    onClick={close}
                    role="dialog"
                    aria-modal="true"
                >
                    <div
                        className="bg-white rounded-2xl p-6 max-w-md w-full relative"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={close}
                            aria-label="Close"
                            className="absolute top-4 right-4 text-slate-400 hover:text-slate-700"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        {step === 'reason' && (
                            <>
                                <h3 className="font-bold text-lg text-slate-900 pr-8">
                                    Why are you reporting this listing?
                                </h3>
                                <p className="text-sm text-slate-500 mt-1 mb-4">
                                    This won&apos;t be shared with the host.
                                </p>
                                <div className="space-y-1">
                                    {reasonsFor(type).map((r) => (
                                        <label
                                            key={r.key}
                                            className="flex items-center gap-3 py-2.5 px-1 cursor-pointer text-slate-800"
                                        >
                                            <input
                                                type="radio"
                                                name="report-reason"
                                                value={r.key}
                                                checked={reason === r.key}
                                                onChange={() => setReason(r.key)}
                                                className="w-4 h-4 accent-slate-900"
                                            />
                                            <span className="text-sm">{r.label}</span>
                                        </label>
                                    ))}
                                </div>
                                <div className="mt-5 flex justify-end">
                                    <button
                                        type="button"
                                        disabled={!reason}
                                        onClick={() => setStep('detail')}
                                        className="px-5 py-2 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-xl disabled:opacity-40"
                                    >
                                        Next
                                    </button>
                                </div>
                            </>
                        )}

                        {step === 'detail' && (
                            <>
                                <h3 className="font-bold text-lg text-slate-900 pr-8">
                                    {reason ? reasonLabel(reason, type) : 'Tell us more'}
                                </h3>
                                <p className="text-sm text-slate-500 mt-1 mb-4">
                                    Tell us what to look at. This won&apos;t be shared with the host.
                                </p>
                                <textarea
                                    value={details}
                                    onChange={(e) => setDetails(e.target.value)}
                                    maxLength={REPORT_DETAILS_MAX}
                                    rows={5}
                                    autoFocus
                                    placeholder="What&apos;s wrong with this listing?"
                                    className="w-full border border-slate-300 rounded-xl p-3 text-sm text-slate-800 focus:border-slate-900 focus:ring-0 outline-none resize-none"
                                />
                                <div className="mt-5 flex items-center justify-between">
                                    <button
                                        type="button"
                                        onClick={() => setStep('reason')}
                                        className="text-sm font-semibold text-slate-500 hover:text-slate-900"
                                    >
                                        Back
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!details.trim() || submitting}
                                        onClick={submit}
                                        className="px-5 py-2 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-xl disabled:opacity-40"
                                    >
                                        {submitting ? 'Sending…' : 'Submit'}
                                    </button>
                                </div>
                            </>
                        )}

                        {step === 'done' && (
                            <>
                                <h3 className="font-bold text-lg text-slate-900 pr-8">
                                    Thanks for letting us know
                                </h3>
                                <p className="text-sm text-slate-600 mt-2 mb-5">
                                    We&apos;ll take a look at {title || 'this listing'}. Your report
                                    isn&apos;t shared with the host.
                                </p>
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={close}
                                        className="px-5 py-2 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-xl"
                                    >
                                        Done
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
