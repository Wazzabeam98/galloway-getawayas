'use client';

import { useState } from 'react';
import { ukDate } from '@/lib/dayKey';
import { openAuthPanel } from '@/components/auth/AuthPanel';
import { QRCodeSVG } from 'qrcode.react';
import type { ReferralStatus, ReferralType } from '@/lib/referrals';

export interface ReferralListItem {
    id: string;
    type: ReferralType | null;
    status: ReferralStatus;
    name: string;
    createdAt: string;
    rewardAmount: number | null;
    rewardPaidAt: string | null;
}

// The three things you can refer, their reward, and what the referred person
// does to earn it. Matches Airbnb's Home / Experience / Service cards, worded
// for this site.
const CARDS: { type: ReferralType; title: string; reward: number; icon: string; earns: string }[] = [
    { type: 'stay', title: 'Holiday let', reward: 50, icon: '🏡', earns: 'lists a holiday let and hosts their first stay' },
    { type: 'experience', title: 'Experience', reward: 25, icon: '🎈', earns: 'runs an experience and completes their first booking' },
    { type: 'trade', title: 'Service', reward: 15, icon: '🛠️', earns: 'lists a service and pays for their first month' },
];

function WhatsAppIcon({ className }: { className?: string }) {
    return (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.79.97-.14.16-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43l-.48-.01c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05 0 1.21.88 2.38 1 2.54.12.16 1.73 2.64 4.19 3.7.59.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28Z" /></svg>);
}
function MessengerIcon({ className }: { className?: string }) {
    return (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.19.16.14.26.35.27.57l.05 1.78c.02.57.6.94 1.12.71l1.99-.88c.17-.07.36-.09.54-.04 1.03.28 2.13.44 3.28.44 5.64 0 10-4.13 10-9.7C22.79 6.13 17.64 2 12 2Zm6 7.46-2.93 4.65c-.47.74-1.47.92-2.17.4l-2.33-1.75a.6.6 0 0 0-.72 0l-3.15 2.39c-.42.32-.97-.18-.69-.63l2.93-4.65c.47-.74 1.47-.92 2.17-.4l2.33 1.75c.21.16.51.16.72 0l3.15-2.39c.42-.32.97.18.69.63Z" /></svg>);
}
function FacebookIcon({ className }: { className?: string }) {
    return (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.47H15.2c-1.24 0-1.63.78-1.63 1.58v1.87h2.78l-.44 2.9h-2.34V22c4.78-.79 8.43-4.94 8.43-9.94Z" /></svg>);
}
function XIcon({ className }: { className?: string }) {
    return (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M18.9 2.5h3.3l-7.2 8.25L23.5 21.5h-6.6l-5.18-6.78-5.93 6.78H2.5l7.7-8.8L2 2.5h6.77l4.68 6.19L18.9 2.5Zm-1.16 17h1.83L7.3 4.4H5.34l12.4 15.1Z" /></svg>);
}

function statusLabel(item: ReferralListItem, reward: number): { text: string; tone: string } {
    switch (item.status) {
        case 'invited':
            return { text: 'Invited — not signed up yet', tone: 'text-slate-500' };
        case 'active':
            return { text: 'Signed up', tone: 'text-slate-700' };
        case 'reward_due':
            return { text: '£' + (item.rewardAmount ?? reward) + ' due to you', tone: 'text-emerald-700 font-semibold' };
        case 'reward_paid':
            return {
                text: '£' + (item.rewardAmount ?? reward) + ' paid' + (item.rewardPaidAt ? ' · ' + ukDate(item.rewardPaidAt) : ''),
                tone: 'text-emerald-700 font-semibold',
            };
        default:
            return { text: '', tone: 'text-slate-500' };
    }
}

export default function ReferHost({
    signedIn,
    link,
    items,
    defaultType,
}: {
    signedIn: boolean;
    link: string | null;
    items: ReferralListItem[];
    defaultType: ReferralType;
}) {
    const [selected, setSelected] = useState<ReferralType>(defaultType);
    const [shareOpen, setShareOpen] = useState(false);
    const [qrOpen, setQrOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copyFailed, setCopyFailed] = useState(false);

    const url = link || '';
    const shareText = 'You’d be a great Galloway Getaways host! List with Galloway Getaways: ' + url;

    // Signed out, every action is "sign in first, then come back to this page
    // with this card chosen". Signed in, pick a card / open the share sheet.
    const signInThen = (type?: ReferralType) =>
        openAuthPanel('/refer' + (type ? '?type=' + type : ''));

    const pickCard = (type: ReferralType) => {
        if (signedIn) setSelected(type);
        else signInThen(type);
    };

    const onShare = () => {
        if (signedIn) setShareOpen(true);
        else signInThen(selected);
    };
    const onQr = () => {
        if (signedIn && url) setQrOpen(true);
        else signInThen();
    };

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(url);
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
                await (navigator as any).share({ title: 'Galloway Getaways', text: 'You’d be a great Galloway Getaways host!', url });
            } catch { /* cancelled */ }
        } else {
            copy();
        }
    };

    const selectedCard = CARDS.find((c) => c.type === selected) || CARDS[0];
    const tile = 'flex flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-3 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50';

    return (
        <div className="space-y-8">
            {/* Headline with the QR button alongside, like Airbnb. */}
            <div className="flex items-start justify-between gap-4">
                <h1 className="text-3xl sm:text-4xl font-bold text-slate-900">Refer a host, earn cash</h1>
                <button
                    type="button"
                    onClick={onQr}
                    aria-label="Show a QR code for your link"
                    className="mt-1 flex-none rounded-full border border-slate-200 p-2.5 text-slate-700 transition hover:bg-slate-100"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
                        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v7h-7v-3" />
                    </svg>
                </button>
            </div>

            {/* The three cards. */}
            <div className="space-y-3">
                {CARDS.map((c) => {
                    const on = c.type === selected;
                    return (
                        <button
                            key={c.type}
                            type="button"
                            onClick={() => pickCard(c.type)}
                            className={
                                'flex w-full items-center gap-4 rounded-2xl border bg-white px-5 py-4 text-left transition ' +
                                (on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-400')
                            }
                        >
                            <span className="text-2xl" aria-hidden="true">{c.icon}</span>
                            <span className="min-w-0">
                                <span className="block font-semibold text-slate-900">{c.title}</span>
                                <span className="block text-sm text-slate-500">You’ll earn £{c.reward}</span>
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Signed in, the chosen card's line. */}
            {signedIn && (
                <p className="text-sm text-slate-600">
                    You’ll earn <strong>£{selectedCard.reward}</strong> when someone you refer {selectedCard.earns}.
                    They get a great deal too — no commission on their first booking{selectedCard.type === 'trade' ? ', and six months free' : ''}.
                </p>
            )}

            {/* The one big button. */}
            <button
                type="button"
                onClick={onShare}
                className="w-full rounded-xl bg-slate-900 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-slate-700"
            >
                Share referral link
            </button>

            {/* The referrals list (signed in). */}
            {signedIn && (
                <div>
                    <h2 className="text-lg font-semibold text-slate-900">Your referrals</h2>
                    {items.length === 0 ? (
                        <p className="mt-3 text-slate-500">
                            No referrals yet. Share your link and they’ll show up here as people sign up and list.
                        </p>
                    ) : (
                        <ul className="mt-4 space-y-3">
                            {items.map((item) => {
                                const reward = CARDS.find((c) => c.type === item.type)?.reward ?? 50;
                                const label = statusLabel(item, reward);
                                const typeLabel = CARDS.find((c) => c.type === item.type)?.title;
                                return (
                                    <li key={item.id} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                        <div className="min-w-0">
                                            <div className="truncate font-medium text-slate-900">{item.name}</div>
                                            <div className="text-xs text-slate-400">
                                                {typeLabel ? typeLabel + ' · ' : ''}referred {ukDate(item.createdAt)}
                                            </div>
                                        </div>
                                        <div className={'flex-none text-right text-sm ' + label.tone}>{label.text}</div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}

            {/* Terms line. */}
            <p className="text-xs text-slate-400">
                Rewards are paid by bank transfer once the person you referred completes their first booking (a holiday let or
                experience) or pays for their first month (a service). Rewards are for genuinely new hosts and providers, one per
                person referred, and can’t be claimed on your own account.
            </p>

            {/* Share pop-up. */}
            {shareOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => setShareOpen(false)}>
                    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-start justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900">Share your referral link</h3>
                                <p className="mt-1 text-sm text-slate-500">You’d be a great Galloway Getaways host!</p>
                            </div>
                            <button type="button" onClick={() => setShareOpen(false)} aria-label="Close" className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <button
                            type="button"
                            onClick={copy}
                            className={'mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition ' + (copied ? 'bg-emerald-600' : 'bg-slate-900 hover:bg-slate-700')}
                        >
                            {copied ? 'Copied' : 'Copy link'}
                        </button>
                        {copyFailed && (
                            <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" />
                        )}

                        <div className="mt-3 grid grid-cols-4 gap-2">
                            <a href={'mailto:?subject=' + encodeURIComponent('List your place with Galloway Getaways') + '&body=' + encodeURIComponent(shareText)} className={tile}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
                                Email
                            </a>
                            <a href={'sms:?&body=' + encodeURIComponent(shareText)} className={tile}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z" /></svg>
                                Messages
                            </a>
                            <a href={'https://wa.me/?text=' + encodeURIComponent(shareText)} target="_blank" rel="noreferrer" className={tile}>
                                <WhatsAppIcon className="h-5 w-5" /> WhatsApp
                            </a>
                            <a href={'fb-messenger://share/?link=' + encodeURIComponent(url)} className={tile}>
                                <MessengerIcon className="h-5 w-5" /> Messenger
                            </a>
                            <a href={'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url)} target="_blank" rel="noreferrer" className={tile}>
                                <FacebookIcon className="h-5 w-5" /> Facebook
                            </a>
                            <a href={'https://twitter.com/intent/tweet?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent('You’d be a great Galloway Getaways host!')} target="_blank" rel="noreferrer" className={tile}>
                                <XIcon className="h-5 w-5" /> X
                            </a>
                            <button type="button" onClick={nativeShare} className={tile}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" /></svg>
                                More
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* QR pop-up. */}
            {qrOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setQrOpen(false)}>
                    <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-slate-900">Your QR code</h3>
                            <button type="button" onClick={() => setQrOpen(false)} aria-label="Close" className="rounded-full p-1 text-slate-400 hover:bg-slate-100">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <div className="mt-4 flex justify-center">
                            <div className="rounded-xl border border-slate-200 p-4">
                                <QRCodeSVG value={url} size={180} />
                            </div>
                        </div>
                        <p className="mt-4 break-all text-xs text-slate-400">{url}</p>
                    </div>
                </div>
            )}
        </div>
    );
}
