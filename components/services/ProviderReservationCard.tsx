'use client';

// The provider's reservation, in the holiday-let host reservation page's style,
// so a stay and an experience read as one product. Shared by the dashboard's
// upcoming list (ProviderUpcoming) and the messages right-hand pane, fed the same
// shape from either side, so the two can never drift.
//
// Top to bottom: the guest large and centred with the item photo tucked into its
// corner, "Liam's group of 2", the date and time, the item, a status pill; then
// cards in the same family — when and where side by side, the guest's note or
// allergy where there is one, the money as one card that opens the full
// breakdown (reusing MoneyCards, the host page's own money card), and Message /
// Call. Each provider kind supplies its own wording (a class, a chef at a
// cottage, a bakery order, a trade job).

import { MessageSquare, Phone } from 'lucide-react';
import ReservationHeader from '@/components/dashboard/reservation/ReservationHeader';
import type { StatusTone } from '@/components/dashboard/reservation/ReservationStatusPill';
import MoneyCards, { type MoneyCardsData } from '@/components/dashboard/reservation/MoneyCards';
import ProviderManageSheet, { type ManageData } from '@/components/services/ProviderManageSheet';
import ProviderCancellationCard, { type CancellationCardData } from '@/components/services/ProviderCancellationCard';

// The "Where" value: a plain line, or a name with an address beneath it.
export type WhereField = string | { line: string; sub?: string | null };

export interface ReservationCardData {
    avatarUrl: string | null;
    initial: string;
    photoUrl: string | null;
    heading: string;                 // "Liam's group of 2"
    whenLabel: string;               // the date & time, per kind
    itemName: string;                // what they booked / the job
    status: { label: string; tone: StatusTone } | null;
    when: { heading: string; value: string };
    // A plain line, or a name with an address beneath it — the latter for a
    // provider looking at a booking held at their own venue, where the useful
    // answer is their listing/venue name and, if we hold it, the address.
    where: WhereField | null;
    note: string | null;
    allergy: string | null;
    money: MoneyCardsData | null;    // the money card when there is money through us
    moneyNote: string | null;        // otherwise a plain note (off-platform / held)
    phone: string | null;
    messageHref: string | null;      // shows the Message button when set
    personFirst: string;
    // The lead guest and the party beneath — the host page's Guests card, for a
    // provider. Null for a trade job (there is no party) and on the guest's own
    // view of the thread.
    guests: { name: string; party: string | null } | null;
    // The provider's own cancellation terms, and the Manage-reservation action
    // sheet. Both are provider-only (never shown to a guest viewing the thread),
    // and only on guest-experience orders — a trade job is off-platform.
    cancellation: CancellationCardData | null;
    manage: ManageData | null;
}

const lifted = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)]';

function FactCard({ heading, children }: { heading: string; children: React.ReactNode }) {
    return (
        <div className={lifted}>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{heading}</div>
            <div className="mt-1 text-sm font-medium text-slate-900">{children}</div>
        </div>
    );
}

export default function ProviderReservationCard({ r, size = 'lg' }: { r: ReservationCardData; size?: 'lg' | 'sm' }) {
    return (
        <div className="space-y-5">
            <ReservationHeader
                avatarUrl={r.avatarUrl}
                initial={r.initial}
                photoUrl={r.photoUrl}
                heading={r.heading}
                sublines={[r.whenLabel, r.itemName]}
                status={r.status}
                size={size}
            />

            {/* When and where, side by side (they stack in the narrow pane). */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FactCard heading={r.when.heading}>{r.when.value}</FactCard>
                {r.where && (
                    <FactCard heading="Where">
                        {typeof r.where === 'string' ? r.where : (
                            <>
                                {r.where.line}
                                {r.where.sub && (
                                    <div className="mt-0.5 text-[13px] font-normal text-slate-500">{r.where.sub}</div>
                                )}
                            </>
                        )}
                    </FactCard>
                )}
            </div>

            {r.allergy && (
                <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-rose-800">⚠ Allergy / dietary need</div>
                    <div className="mt-1 whitespace-pre-line text-sm text-rose-950">{r.allergy}</div>
                </div>
            )}
            {r.note && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">In the guest&rsquo;s words</div>
                    <div className="mt-1 whitespace-pre-line text-sm text-amber-950">{r.note}</div>
                </div>
            )}

            {/* Who's coming — the lead guest and the party beneath, in the host
                page's Guests-card style. */}
            {r.guests && (
                <div className={lifted}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Guests</div>
                    <div className="mt-3 flex items-center gap-3">
                        {r.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.avatarUrl} alt="" className="h-11 w-11 flex-none rounded-full object-cover ring-1 ring-slate-200" />
                        ) : (
                            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-slate-100 text-base font-semibold text-slate-500">{r.initial}</span>
                        )}
                        <div className="min-w-0">
                            <div className="truncate text-base font-semibold text-slate-900">{r.guests.name}</div>
                            {r.guests.party && <div className="text-[13px] text-slate-500">{r.guests.party}</div>}
                        </div>
                    </div>
                </div>
            )}

            {r.cancellation && <ProviderCancellationCard data={r.cancellation} />}

            {r.money
                ? <MoneyCards {...r.money} />
                : r.moneyNote
                    ? <div className={lifted}>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Money</div>
                        <div className="mt-1 text-sm text-slate-600">{r.moneyNote}</div>
                    </div>
                    : null}

            {r.manage && <ProviderManageSheet data={r.manage} />}

            {(r.messageHref || r.phone) && (
                <div className="flex gap-2">
                    {r.messageHref && (
                        <a href={r.messageHref} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">
                            <MessageSquare className="h-4 w-4" /> Message {r.personFirst}
                        </a>
                    )}
                    {r.phone && (
                        <a href={'tel:' + r.phone} className={'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-500' + (r.messageHref ? '' : ' flex-1')}>
                            <Phone className="h-4 w-4" /> Call
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
