'use client';

// The one reservation card, in the holiday-let host reservation page's style, so
// a STAY and an EXPERIENCE read as one product from every side — the host, the
// guest and the provider, on the dashboard and in Messages, at any width.
//
// It is viewer-aware through its data, not through branches here: the route that
// feeds it (a booking thread, an order thread, the provider dashboard) decides
// what a viewer may see and hands over exactly that shape. Stay-only cards
// (split check-in/out with arrival, hosted-by, the guests list, booked/reference)
// render only when their fields are present, so an experience — which sends none
// of them — is unchanged from #197.
//
// Top to bottom: the header (avatar beside the listing photo, "Isla's group of
// 2"); check-in and check-out split, or an experience's when/where; the guest's
// notes; who's coming; hosted-by / provided-by; the cancellation policy; the
// money as one card that opens the full breakdown; booked date + reference; then
// View the listing and Manage reservation.

import { MessageSquare, Phone, LogIn, LogOut, KeyRound, Wifi, ExternalLink, AlertTriangle } from 'lucide-react';
import ReservationHeader from '@/components/dashboard/reservation/ReservationHeader';
import type { StatusTone } from '@/components/dashboard/reservation/ReservationStatusPill';
import MoneyCards, { type MoneyCardsData } from '@/components/dashboard/reservation/MoneyCards';
import CancellationPolicyCard from '@/components/dashboard/reservation/CancellationPolicyCard';
import ProviderManageSheet, { type ManageData } from '@/components/services/ProviderManageSheet';
import GuestManageSheet, { type GuestManageData } from '@/components/marketplace/GuestManageSheet';
import ProviderCancellationCard, { type CancellationCardData } from '@/components/services/ProviderCancellationCard';
import EnquiryActions from '@/components/services/EnquiryActions';
import UpcomingJobActions from '@/components/services/UpcomingJobActions';

// The "Where" value: a plain line, or a name with an address beneath it.
export type WhereField = string | { line: string; sub?: string | null };

// One side of a split stay date — the weekday, the DD/MM/YYYY date, and the time.
export interface StayDayCell {
    heading: string;                 // "Check-in" / "Check-out"
    weekday: string;                 // "Thursday"
    dateLabel: string;               // "09/10/2026"
    timeLabel?: string | null;       // "From 3pm" / "By 11am"
}
// The arrival secrets, already gated by the route to the rules that allow them
// (the host with the listing permission; the guest inside the arrival window).
export interface StayArrival {
    doorCode?: string | null;
    wifiName?: string | null;
    wifiPassword?: string | null;
}
export interface StayField {
    checkIn: StayDayCell;
    checkOut: StayDayCell;
    arrival?: StayArrival | null;
}

// The person who owns the stay / provides the experience, as a card.
export interface HostedByField {
    label: string;                   // "Hosted by" / "Provided by"
    name: string;                    // first name only under the display-names guard
    sub?: string | null;             // the area, or a line beneath
    avatarUrl?: string | null;
    initial: string;
    isViewer?: boolean;              // " · you" when the viewer owns it
}

// Who's coming, as an avatar row for the lead guest and summary rows for the rest.
export interface GuestsListField {
    lead: { name: string; avatarUrl?: string | null; initial: string };
    extras: string[];                // ["+1 adult", "+1 child", "+1 pet"]
}

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
    // The guest's own Manage-reservation sheet (change/cancel), the mirror of
    // `manage`. Exactly one of the two is ever set — a viewer is a provider or a
    // guest — so each party sees only its own actions.
    guestManage: GuestManageData | null;
    // A trade's still-to-answer request: Accept / Decline, on the request itself
    // wherever the card is shown. Set only for an unanswered enquiry the viewing
    // trade owns; absent/null once it is accepted or declined.
    requestActions?: { enquiryId: string } | null;
    // A soft clash warning shown above Accept / Decline: they already have a job
    // in this window that day. A heads-up, not a block.
    clashWarning?: string | null;
    // A trade's accepted, still-upcoming job: ask the owner for a different day,
    // or call the job off. Absent for a request still to answer and for past work.
    jobActions?: { enquiryId: string; preferredDate: string | null; proposedDate: string | null } | null;

    // ---- Stay-only fields (a cottage booking). Absent on an experience. ----
    stay?: StayField | null;                 // renders the split check-in/out cards
    guestsList?: GuestsListField | null;     // the avatar-row Guests card
    hostedBy?: HostedByField | null;         // Hosted by / Provided by
    stayCancellation?: { tier: string; summary: string; freeUntil?: string | null } | null;
    booked?: string | null;                  // "28/09/2026"
    reference?: string | null;               // "1ed31575"
    viewListingHref?: string | null;
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

function DayCard({ cell, icon: Icon }: { cell: StayDayCell; icon: any }) {
    return (
        <div className={lifted}>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Icon className="h-3.5 w-3.5 text-slate-400" />{cell.heading}
            </div>
            <div className="mt-1 text-sm font-medium text-slate-900">{cell.weekday}</div>
            <div className="text-sm text-slate-600">{cell.dateLabel}</div>
            {cell.timeLabel && <div className="mt-1 text-sm text-slate-600">{cell.timeLabel}</div>}
        </div>
    );
}

export default function ProviderReservationCard({ r, size = 'lg' }: { r: ReservationCardData; size?: 'lg' | 'sm' }) {
    const arrival = r.stay && r.stay.arrival;
    const hasArrival = !!(arrival && (arrival.doorCode || arrival.wifiName || arrival.wifiPassword));
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

            {/* A trade's request to answer — Accept / Decline on the request
                itself, not tucked away on another page. Sits directly under the
                header so it is the first thing the trade acts on. */}
            {r.requestActions && (
                <div className={lifted + ' space-y-3'}>
                    {r.clashWarning && (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
                            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600" strokeWidth={2} />
                            <span>{r.clashWarning}</span>
                        </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">Reply to this request</div>
                        <EnquiryActions enquiryId={r.requestActions.enquiryId} />
                    </div>
                </div>
            )}

            {/* Check-in / check-out for a stay; the experience's when/where otherwise. */}
            {r.stay ? (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <DayCard cell={r.stay.checkIn} icon={LogIn} />
                        <DayCard cell={r.stay.checkOut} icon={LogOut} />
                    </div>
                    {hasArrival && (
                        <div className={lifted}>
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Arrival details</div>
                            <div className="mt-3 space-y-3">
                                {arrival!.doorCode && (
                                    <div className="flex items-center gap-3">
                                        <KeyRound className="h-4 w-4 flex-none text-slate-400" />
                                        <div className="min-w-0">
                                            <div className="text-[13px] text-slate-500">Door code</div>
                                            <div className="text-sm font-semibold tracking-wide text-slate-900">{arrival!.doorCode}</div>
                                        </div>
                                    </div>
                                )}
                                {(arrival!.wifiName || arrival!.wifiPassword) && (
                                    <div className="flex items-center gap-3">
                                        <Wifi className="h-4 w-4 flex-none text-slate-400" />
                                        <div className="min-w-0">
                                            <div className="text-[13px] text-slate-500">Wi-Fi</div>
                                            <div className="text-sm font-medium text-slate-900">
                                                {arrival!.wifiName}
                                                {arrival!.wifiPassword ? <span className="text-slate-500"> · {arrival!.wifiPassword}</span> : null}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
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
            )}

            {r.allergy && (
                <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-rose-800">⚠ Allergy / dietary need</div>
                    <div className="mt-1 whitespace-pre-line text-sm text-rose-950">{r.allergy}</div>
                </div>
            )}
            {r.note && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                        {r.stay ? 'Your notes' : 'In the guest’s words'}
                    </div>
                    <div className="mt-1 whitespace-pre-line text-sm text-amber-950">{r.note}</div>
                </div>
            )}

            {/* Who's coming — the avatar-row list for a stay, or the lead+party card. */}
            {r.guestsList ? (
                <div className={lifted}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Guests</div>
                    <div className="mt-3 space-y-3">
                        <div className="flex items-center gap-3">
                            {r.guestsList.lead.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={r.guestsList.lead.avatarUrl} alt="" className="h-9 w-9 flex-none rounded-full object-cover ring-1 ring-slate-200" />
                            ) : (
                                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500">{r.guestsList.lead.initial}</span>
                            )}
                            <div className="truncate text-sm font-semibold text-slate-900">{r.guestsList.lead.name}</div>
                        </div>
                        {r.guestsList.extras.map((line, i) => (
                            <div key={i} className="flex items-center gap-3">
                                <span className="h-9 w-9 flex-none rounded-full border border-dashed border-slate-300 bg-slate-50" />
                                <div className="text-sm text-slate-600">{line}</div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : r.guests ? (
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
            ) : null}

            {/* Hosted by / Provided by. */}
            {r.hostedBy && (
                <div className={lifted}>
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-base font-semibold text-slate-900">
                                {r.hostedBy.isViewer ? r.hostedBy.label + ' you' : r.hostedBy.label + ' ' + r.hostedBy.name}
                            </div>
                            {r.hostedBy.sub && <div className="mt-0.5 text-[13px] text-slate-500">{r.hostedBy.sub}</div>}
                        </div>
                        {r.hostedBy.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.hostedBy.avatarUrl} alt="" className="h-11 w-11 flex-none rounded-full object-cover ring-1 ring-slate-200" />
                        ) : (
                            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-slate-100 text-base font-semibold text-slate-500">{r.hostedBy.initial}</span>
                        )}
                    </div>
                </div>
            )}

            {r.stayCancellation
                ? <CancellationPolicyCard tier={r.stayCancellation.tier} summary={r.stayCancellation.summary} freeUntil={r.stayCancellation.freeUntil} />
                : r.cancellation ? <ProviderCancellationCard data={r.cancellation} /> : null}

            {r.money
                ? <MoneyCards {...r.money} />
                : r.moneyNote
                    ? <div className={lifted}>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Money</div>
                        <div className="mt-1 text-sm text-slate-600">{r.moneyNote}</div>
                    </div>
                    : null}

            {/* Booked date + reference. */}
            {(r.booked || r.reference) && (
                <div className={lifted}>
                    <div className="grid grid-cols-2 gap-x-6">
                        {r.booked && (
                            <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Booked</div>
                                <div className="mt-1 text-sm font-medium text-slate-900">{r.booked}</div>
                            </div>
                        )}
                        {r.reference && (
                            <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Reference</div>
                                <div className="mt-1 font-mono text-sm tracking-wide text-slate-700">{r.reference}</div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {r.viewListingHref && (
                <a href={r.viewListingHref} className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
                    <ExternalLink className="h-3.5 w-3.5" /> View the listing
                </a>
            )}

            {r.manage && <ProviderManageSheet data={r.manage} />}
            {r.guestManage && <GuestManageSheet data={r.guestManage} />}
            {r.jobActions && (
                <UpcomingJobActions
                    enquiryId={r.jobActions.enquiryId}
                    preferredDate={r.jobActions.preferredDate}
                    proposedDate={r.jobActions.proposedDate}
                />
            )}

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
