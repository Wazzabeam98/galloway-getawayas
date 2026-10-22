'use client';

import { useState } from 'react';
import { ukDate } from '@/lib/dayKey';
import type { ReferralStatus } from '@/lib/referrals';

export interface ReferralListItem {
    id: string;
    status: ReferralStatus;
    name: string;
    createdAt: string;
    rewardAmount: number | null;
    rewardPaidAt: string | null;
}

const REWARD = 50;

function WhatsAppIcon({ className }: { className?: string }) {
    return (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.79.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43l-.48-.01c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05 0 1.21.88 2.38 1 2.54.12.16 1.73 2.64 4.19 3.7.59.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z" /></svg>);
}

// What the referrer reads for each referral: a plain phrase and a tone colour.
function statusLabel(item: ReferralListItem): { text: string; tone: string } {
    switch (item.status) {
        case 'invited':
            return { text: 'Invited — not listed yet', tone: 'text-slate-500' };
        case 'listed':
            return { text: 'Listed a property', tone: 'text-slate-700' };
        case 'first_stay_done':
            return { text: 'First stay done — £' + (item.rewardAmount ?? REWARD) + ' due to you', tone: 'text-emerald-700 font-semibold' };
        case 'reward_paid':
            return {
                text: '£' + (item.rewardAmount ?? REWARD) + ' paid' + (item.rewardPaidAt ? ' · ' + ukDate(item.rewardPaidAt) : ''),
                tone: 'text-emerald-700 font-semibold',
            };
        default:
            return { text: '', tone: 'text-slate-500' };
    }
}

export default function ReferHost({
    code,
    link,
    items,
    firstName,
}: {
    code: string;
    link: string;
    items: ReferralListItem[];
    firstName: string;
}) {
    const [copied, setCopied] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);

    const shareText =
        'Know someone with a holiday let? List with Galloway Getaways and pay no commission on your first booking: ' + link;

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setCopyFailed(false);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopyFailed(true);
        }
    };

    const nativeShare = async () => {
        if (typeof navigator !== 'undefined' && (navigator as any).share) {
            try {
                await (navigator as any).share({
                    title: 'Host with Galloway Getaways',
                    text: 'Know someone with a holiday let? Refer them and they pay no commission on their first booking.',
                    url: link,
                });
            } catch {
                /* the person cancelled the share sheet — nothing to do */
            }
        } else {
            copy();
        }
    };

    const tile =
        'flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50';

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold text-slate-900">Refer a host, get £{REWARD}</h1>
                <p className="mt-3 text-lg text-slate-700">
                    {firstName ? firstName + ', know' : 'Know'} someone with a holiday let? Refer them
                    and get £{REWARD} when they host their first stay. They’ll pay no commission on
                    their first booking.
                </p>
            </div>

            {/* The personal link and the ways to share it — a surface you act on,
                so it lifts. */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                <label className="block text-sm font-semibold text-slate-900">Your referral link</label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                        readOnly
                        value={link}
                        onFocus={(e) => e.currentTarget.select()}
                        onClick={(e) => e.currentTarget.select()}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    />
                    <button
                        type="button"
                        onClick={copy}
                        className={
                            'flex-none rounded-xl px-4 py-2 text-sm font-semibold text-white transition ' +
                            (copied ? 'bg-emerald-600' : 'bg-slate-900 hover:bg-slate-700')
                        }
                    >
                        {copied ? 'Copied' : 'Copy link'}
                    </button>
                </div>
                {copyFailed && (
                    <p className="mt-2 text-xs text-slate-500">
                        Couldn’t copy automatically — select the link above and copy it by hand.
                    </p>
                )}

                <div className="mt-4 grid grid-cols-3 gap-2">
                    <a
                        href={'https://wa.me/?text=' + encodeURIComponent(shareText)}
                        target="_blank"
                        rel="noreferrer"
                        className={tile}
                    >
                        <WhatsAppIcon className="h-5 w-5 flex-none" /> WhatsApp
                    </a>
                    <a
                        href={
                            'mailto:?subject=' +
                            encodeURIComponent('List your holiday let with Galloway Getaways') +
                            '&body=' +
                            encodeURIComponent(shareText)
                        }
                        className={tile}
                    >
                        Email
                    </a>
                    <button type="button" onClick={nativeShare} className={tile}>
                        Share
                    </button>
                </div>
            </div>

            {/* How each referral is getting on. */}
            <div>
                <h2 className="text-lg font-semibold text-slate-900">Your referrals</h2>
                {items.length === 0 ? (
                    <p className="mt-3 text-slate-500">
                        No referrals yet. Share your link and they’ll show up here as your friends
                        sign up and list.
                    </p>
                ) : (
                    <ul className="mt-4 space-y-3">
                        {items.map((item) => {
                            const label = statusLabel(item);
                            return (
                                <li
                                    key={item.id}
                                    className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3"
                                >
                                    <div className="min-w-0">
                                        <div className="truncate font-medium text-slate-900">{item.name}</div>
                                        <div className="text-xs text-slate-400">
                                            Referred {ukDate(item.createdAt)}
                                        </div>
                                    </div>
                                    <div className={'flex-none text-right text-sm ' + label.tone}>{label.text}</div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <p className="text-xs text-slate-400">
                We pay rewards by bank transfer once the referred host’s first stay is complete.
                Rewards are for genuinely new hosts and can’t be claimed on your own account.
            </p>
        </div>
    );
}
