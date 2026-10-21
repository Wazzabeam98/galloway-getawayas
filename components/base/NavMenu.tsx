import React from 'react'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
    PopoverClose,
} from "@/components/ui/popover"
import { UserIcon } from 'lucide-react'
import LoginModel from '../auth/LoginModel'
import SignOut from '../common/SignOut'
import ModeSwitch from './ModeSwitch'
import Link from 'next/link'
import { getImageUrl } from '@/lib/utils'
import MessagesLink from './MessagesLink'
import InvitesLink from './InvitesLink'
import MenuUnreadDot from './MenuUnreadDot'
import BookingsLink from './BookingsLink'
import RequestsLink from './RequestsLink'
import OwnerToolsLink from './OwnerToolsLink'
import { ALL_HOST_PERMS, HostPerms } from '@/lib/workMode'

const itemClass = 'hover:bg-slate-200 rounded-md p-2 cursor-pointer';

const NavMenu = ({
    session,
    experiencesOpen = false,
    isHost = false,
    ownsAny = true,
    isFullAccessSomewhere = true,
    hostPerms = ALL_HOST_PERMS,
    isAdmin = false,
    mode = 'travel',
    hasCompletedStay = false,
    isProvider = false,
    providerAudience = null,
    providerPerms = ALL_HOST_PERMS,
    providerFullAccess = true,
    avatarUrl = null,
    initial = '',
}: {
    session: object | undefined;
    experiencesOpen?: boolean;
    isHost?: boolean;
    // Owns at least one listing. The owner-only sections — Reviews, and the
    // Co-hosts page that hands out access — show only to an owner; a pure
    // co-host never sees them, whatever else they were given. Defaults true so
    // an owner is the safe fallback if a caller forgets to pass it.
    ownsAny?: boolean;
    // Owns a listing, or co-hosts one with every permission ticked. A full-access
    // co-host is the owner's equal, so they get the owner-only Co-hosts section.
    isFullAccessSomewhere?: boolean;
    // What they may do, rolled up across every listing. An owner has all of it;
    // a co-host sees a section only where the owner granted it. Defaults to the
    // full set for the same reason as ownsAny.
    hostPerms?: HostPerms;
    isAdmin?: boolean;
    mode?: 'host' | 'travel';
    hasCompletedStay?: boolean;
    isProvider?: boolean;
    providerAudience?: string | null;
    // The same two for a business (an experience or a trade): what they may do
    // across the businesses they own or co-host, and whether they may hand out
    // access (owner or full-access co-host). Default to an owner's.
    providerPerms?: HostPerms;
    providerFullAccess?: boolean;
    avatarUrl?: string | null;
    initial?: string;
}) => {
    const hostView = isHost && mode === 'host';
    // A provider sees their providing menu only on their providing side, exactly
    // as a host sees the host menu only in host mode. In travelling mode a
    // provider gets the guest menu (their own trips), so the one mode switch
    // flips the dropdown for a provider the same way it does for a host. A host
    // who is also a provider is handled by hostView above.
    const providerView = isProvider && !isHost && mode === 'host';
    // A guest-experience provider (a chef, a sauna, a class) is booked and paid
    // through us, so their menu is a Calendar and Earnings. A trade provider (a
    // plumber) is contacted by Enquiry and paid off-platform, so theirs is
    // Enquiries and no Earnings.
    const isGuestProvider = isProvider && providerAudience === 'guest';

    return (
        <Popover>
            {/* A BUTTON, BECAUSE THIS IS THE ONLY WAY INTO THE SIGNED-IN SITE.
                This was a <div>. Radix's asChild hands it aria-expanded and
                aria-haspopup, but a div is not focusable and Radix does not
                make it one, so the control never entered the tab order. Checked
                on 31 August 2026: tab order on the home page went logo →
                "Become a host" → the hero carousel → search, and never reached
                this. Log In, Sign Up, Listings, Bookings, Calendar, Earnings,
                Co-hosts and Messages all live behind it and nowhere else — so a
                host using a keyboard or a screen reader could not sign in, and
                could not reach a single host page if they did. */}
            <PopoverTrigger asChild>
                <button
                    type='button'
                    aria-label='Your account and menu'
                    className='flex items-center gap-2 border p-1.5 pl-3 rounded-full cursor-pointer hover:shadow-md transition'
                >
                    <MenuUnreadDot enabled={session != null} host={isHost} provider={isProvider} admin={isAdmin} />
                    {session != null ? (
                        <div className='w-8 h-8 rounded-full overflow-hidden bg-slate-900 text-white flex items-center justify-center text-sm font-semibold flex-shrink-0'>
                            {avatarUrl ? (
                                <img
                                    src={getImageUrl(avatarUrl)}
                                    alt=''
                                    className='w-full h-full object-cover'
                                />
                            ) : (
                                initial || <UserIcon className='w-4 h-4' />
                            )}
                        </div>
                    ) : (
                        <div className='w-8 h-8 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center flex-shrink-0'>
                            <UserIcon className='w-4 h-4' />
                        </div>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent className='mr-6'>
                <ul>
                    {/* Experiences is not repeated here — it already sits in the top
                        nav bar (Navbar.tsx), so a second copy in the dropdown was
                        just noise. */}
                    {session != null ? (
                        <>
                            {/* A co-host invitation waiting on them, whichever
                                side they're on — first, so it can't be missed. */}
                            <InvitesLink className={itemClass} />
                            {hostView ? (
                                <>
                                    {/* The hub where their properties live — their
                                        own and any they help with — so every host
                                        lands somewhere. Each section below shows
                                        only where they may act: a co-host sees
                                        exactly what the owner gave them, nothing
                                        more. Reviews comes with the messages
                                        permission; Co-hosts is for the owner and
                                        any full-access co-host (the owner's equal),
                                        the people who may hand out access. */}
                                    <li className={itemClass}>
                                        <Link href='/dashboard'>Listings</Link>
                                    </li>
                                    {hostPerms.can_bookings && (
                                        <li className={itemClass}>
                                            <BookingsLink />
                                        </li>
                                    )}
                                    {hostPerms.can_calendar && (
                                        <li className={itemClass}>
                                            <Link href='/dashboard/calendar'>Calendar</Link>
                                        </li>
                                    )}
                                    {hostPerms.can_messages && (
                                        <li className={itemClass}>
                                            <Link href='/dashboard/reviews'>Reviews</Link>
                                        </li>
                                    )}
                                    {hostPerms.can_earnings && (
                                        <li className={itemClass}>
                                            <Link href='/dashboard/earnings'>Earnings</Link>
                                        </li>
                                    )}
                                    {isFullAccessSomewhere && (
                                        <li className={itemClass}>
                                            <Link href='/dashboard/people'>Co-hosts</Link>
                                        </li>
                                    )}
                                    {hostPerms.can_messages && (
                                        <li className={itemClass}>
                                            <MessagesLink />
                                        </li>
                                    )}
                                    {/* No "Services" or "Your trips" here: like
                                        Airbnb's hosting menu, this is the host's
                                        work. Services live in the site footer,
                                        and trips belong to travelling mode —
                                        both reached by switching out of hosting. */}
                                </>
                            ) : providerView ? (
                                /* A provider's menu is their business, not a
                                   traveller's. On their providing side "Your
                                   trips" and "Become a host" give way to their
                                   own things; switch to travelling and they get
                                   the guest menu below instead. (A provider who
                                   is also a host gets the full host menu in host
                                   mode, above.) */
                                <>
                                    {isGuestProvider ? (
                                        /* A guest-experience provider's menu is the
                                           holiday-let host's, item for item (Liam,
                                           21 Oct 2026): Reservations, Calendar, Your
                                           listing, Messages, Reviews, Earnings,
                                           Co-hosts — and, like Airbnb's hosting menu,
                                           no "Your trips": trips belong to travelling
                                           mode, one switch away. Shown from the moment
                                           they apply (lib/workSide), each item only
                                           where they may act. */
                                        <>
                                            {providerPerms.can_bookings && (
                                                <li className={itemClass}>
                                                    {/* With the number of booking requests still to
                                                        confirm — the host's reservations badge. */}
                                                    <RequestsLink label='Reservations' />
                                                </li>
                                            )}
                                            {providerPerms.can_calendar && (
                                                <li className={itemClass}>
                                                    <Link href='/services/dashboard/calendar'>Calendar</Link>
                                                </li>
                                            )}
                                            {providerPerms.can_listing && (
                                                <li className={itemClass}>
                                                    <Link href='/services/dashboard/edit'>Your listing</Link>
                                                </li>
                                            )}
                                            {providerPerms.can_messages && (
                                                <li className={itemClass}>
                                                    <MessagesLink />
                                                </li>
                                            )}
                                            {providerPerms.can_messages && (
                                                <li className={itemClass}>
                                                    <Link href='/services/dashboard/reviews'>Reviews</Link>
                                                </li>
                                            )}
                                            {providerPerms.can_earnings && (
                                                <li className={itemClass}>
                                                    <Link href='/services/dashboard/earnings'>Earnings</Link>
                                                </li>
                                            )}
                                            {providerFullAccess && (
                                                <li className={itemClass}>
                                                    <Link href='/services/dashboard/people'>Co-hosts</Link>
                                                </li>
                                            )}
                                        </>
                                    ) : (
                                        /* A trade's menu, in a host's shape: Requests,
                                           Calendar, Your listing. "Your reservations" and
                                           "Enquiries" used to be two names for the one
                                           screen; they are one line now — Requests —
                                           carrying the count of enquiries still to answer,
                                           the same green badge a host's reservations line
                                           gets. */
                                        <>
                                            {providerPerms.can_bookings && (
                                                <li className={itemClass}>
                                                    <RequestsLink className='font-semibold text-emerald-800' />
                                                </li>
                                            )}
                                            {providerPerms.can_calendar && (
                                                <li className={itemClass}>
                                                    <Link href='/services/dashboard/calendar'>Calendar</Link>
                                                </li>
                                            )}
                                            {providerPerms.can_listing && (
                                                <li className={itemClass}>
                                                    <Link href='/services/dashboard/edit'>Your listing</Link>
                                                </li>
                                            )}
                                            {/* Co-hosts, as on the host side: for the owner and
                                                a full-access co-host — the people who may hand
                                                out access to the business. */}
                                            {providerFullAccess && (
                                                <li className={itemClass}>
                                                    <Link href='/services/dashboard/people'>Co-hosts</Link>
                                                </li>
                                            )}
                                            {/* A provider's messages are their job/booking
                                                threads — a home they can navigate to so a
                                                thread is never a lost email. The count is the
                                                same badge the host gets. */}
                                            {providerPerms.can_messages && (
                                                <li className={itemClass}>
                                                    <MessagesLink />
                                                </li>
                                            )}
                                            {/* A trade is a traveller too: their own stays
                                                and booked experiences, one place. */}
                                            <li className={itemClass}>
                                                <Link href='/trips'>Your trips</Link>
                                            </li>
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    <li className={itemClass}>
                                        <Link href='/trips'>Your trips</Link>
                                    </li>
                                    {/* Nothing to show until a stay is finished. */}
                                    {hasCompletedStay && (
                                        <li className={itemClass}>
                                            <Link href='/passport'>Your passport</Link>
                                        </li>
                                    )}
                                    <li className={itemClass}>
                                        <MessagesLink />
                                    </li>
                                    {/* Renders its own <li> only when something is
                                        waiting — wrapping it in a <li> here left an
                                        empty, hoverable phantom row the rest of the
                                        time. Only for someone who answers bookings:
                                        a co-host without that grant has none to see. */}
                                    {hostPerms.can_bookings && <BookingsLink onlyWhenWaiting />}
                                </>
                            )}

                            <li className={itemClass}>
                                <Link href='/account'>Account settings</Link>
                            </li>

                            {isAdmin && (
                                <>
                                    <div className='border-t my-1' />
                                    <li className={itemClass}>
                                        {/* Carries the count still waiting on the
                                            admin across all three review queues. */}
                                        <OwnerToolsLink className='font-semibold text-emerald-800' />
                                    </li>
                                </>
                            )}

                            <div className='border-t my-1' />

                            {isHost ? (
                                <li className={itemClass}>
                                    <ModeSwitch
                                        mode={mode}
                                        className='w-full text-left rounded-md'
                                    />
                                </li>
                            ) : isProvider ? (
                                /* A provider gets the same switch a host does —
                                   the only way to reach the travelling side on
                                   mobile, where the top-bar switch is hidden —
                                   pointed at their provider dashboard and worded
                                   "providing", not "hosting". */
                                <li className={itemClass}>
                                    <ModeSwitch
                                        mode={mode}
                                        workHref='/services/dashboard'
                                        workLabel='providing'
                                        className='w-full text-left rounded-md'
                                    />
                                </li>
                            ) : (
                                <li className={itemClass}>
                                    <Link href='/business'>Start hosting</Link>
                                </li>
                            )}

                            <SignOut />
                        </>
                    ) : (
                        <>
                            {/* One item for both, as on Airbnb: the panel works out
                                whether you are new or returning. The menu closes
                                as the panel opens, as Airbnb's does. */}
                            <PopoverClose asChild>
                                <LoginModel />
                            </PopoverClose>
                            <li className={itemClass}>
                                <Link href='/business'>Start hosting</Link>
                            </li>
                        </>
                    )}
                </ul>
            </PopoverContent>
        </Popover>
    )
}

export default NavMenu
