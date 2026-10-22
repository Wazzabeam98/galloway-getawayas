'use client';

import { useState } from 'react';
import { ukDate } from '@/lib/dayKey';
import { openAuthPanel } from '@/components/auth/AuthPanel';
import { QRCodeSVG } from 'qrcode.react';
import SharePopup from '@/components/SharePopup';
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
    defaultType: ReferralType | null;
}) {
    // Nothing chosen to begin with (unless a ?type= link chose it): the reward
    // line stays hidden and Share stays greyed out until a card is picked.
    const [selected, setSelected] = useState<ReferralType | null>(defaultType);
    const [shareOpen, setShareOpen] = useState(false);
    const [qrOpen, setQrOpen] = useState(false);

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
        if (!selected) return;
        if (signedIn) setShareOpen(true);
        else signInThen(selected);
    };
    const onQr = () => {
        if (signedIn && url) setQrOpen(true);
        else signInThen();
    };

    // No card chosen by default (#500): null until the person picks one, which
    // keeps the Share button greyed out. The inline copy/share/tile helpers are
    // gone — the shared SharePopup component owns all of that now.
    const selectedCard = CARDS.find((c) => c.type === selected) || null;

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

            {/* Signed in, the chosen card's line — once a card is chosen. */}
            {signedIn && selectedCard && (
                <p className="text-sm text-slate-600">
                    You’ll earn <strong>£{selectedCard.reward}</strong> when someone you refer {selectedCard.earns}.
                    They get a great deal too — no commission on their first booking{selectedCard.type === 'trade' ? ', and six months free' : ''}.
                </p>
            )}

            {/* The one big button, in the brand green; greyed out and
                unclickable until a card is chosen. */}
            <button
                type="button"
                onClick={onShare}
                disabled={!selected}
                className="w-full rounded-xl bg-emerald-700 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
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

            {/* Share pop-up — the shared component, reused on listing pages too. */}
            <SharePopup
                open={shareOpen}
                onClose={() => setShareOpen(false)}
                title="Share your referral link"
                subtitle="You’d be a great Galloway Getaways host!"
                url={url}
                shareText={shareText}
                emailSubject="List your place with Galloway Getaways"
                tweetText="You’d be a great Galloway Getaways host!"
                nativeTitle="Galloway Getaways"
            />

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
