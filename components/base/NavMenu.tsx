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
import MenuUnreadDot from './MenuUnreadDot'
import BookingsLink from './BookingsLink'
import RequestsLink from './RequestsLink'

const itemClass = 'hover:bg-slate-200 rounded-md p-2 cursor-pointer';

const NavMenu = ({
    session,
    experiencesOpen = false,
    isHost = false,
    isAdmin = false,
    mode = 'travel',
    hasCompletedStay = false,
    isProvider = false,
    providerAudience = null,
    avatarUrl = null,
    initial = '',
}: {
    session: object | undefined;
    experiencesOpen?: boolean;
    isHost?: boolean;
    isAdmin?: boolean;
    mode?: 'host' | 'travel';
    hasCompletedStay?: boolean;
    isProvider?: boolean;
    providerAudience?: string | null;
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
                    <MenuUnreadDot enabled={session != null} host={isHost} provider={isProvider && !isGuestProvider} />
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
                            {hostView ? (
                                <>
                                    <li className={itemClass}>
                                        <Link href='/dashboard'>Listings</Link>
                                    </li>
                                    <li className={itemClass}>
                                        <BookingsLink />
                                    </li>
                                    {/* Third, next to Bookings, not seventh
                                        under Co-hosts: services are a host's
                                        second revenue line and belong beside
                                        the first, above the operational items. */}
                                    <li className={itemClass}>
                                        <Link href='/services'>Services</Link>
                                    </li>
                                    <li className={itemClass}>
                                        <Link href='/dashboard/calendar'>Calendar</Link>
                                    </li>
                                    <li className={itemClass}>
                                        <Link href='/dashboard/reviews'>Reviews</Link>
                                    </li>
                                    <li className={itemClass}>
                                        <Link href='/dashboard/earnings'>Earnings</Link>
                                    </li>
                                    <li className={itemClass}>
                                        <Link href='/dashboard/people'>Co-hosts</Link>
                                    </li>
                                    <li className={itemClass}>
                                        <MessagesLink />
                                    </li>
                                    {/* A host travels too — their own stays and
                                        experiences live here, same as any guest. */}
                                    <li className={itemClass}>
                                        <Link href='/trips'>Your trips</Link>
                                    </li>
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
                                        /* A guest-experience provider is booked and paid
                                           through us: their listing, their bookings,
                                           the calendar, then Earnings. Their word is
                                           "bookings" — they take bookings for their
                                           experiences, not reservations for a property. */
                                        <>
                                            <li className={itemClass}>
                                                <Link href='/services/dashboard/edit' className='font-semibold text-emerald-800'>
                                                    Your listing
                                                </Link>
                                            </li>
                                            <li className={itemClass}>
                                                <Link href='/services/dashboard'>Your bookings</Link>
                                            </li>
                                            <li className={itemClass}>
                                                <Link href='/services/dashboard/calendar'>Calendar</Link>
                                            </li>
                                            <li className={itemClass}>
                                                <Link href='/services/dashboard/earnings'>Earnings</Link>
                                            </li>
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
                                            <li className={itemClass}>
                                                <RequestsLink className='font-semibold text-emerald-800' />
                                            </li>
                                            <li className={itemClass}>
                                                <Link href='/services/dashboard/calendar'>Calendar</Link>
                                            </li>
                                            <li className={itemClass}>
                                                <Link href='/services/dashboard/edit'>Your listing</Link>
                                            </li>
                                        </>
                                    )}
                                    {/* A provider's messages are their job/booking
                                        threads — a home they can navigate to so a
                                        thread is never a lost email. The count is the
                                        same badge the host gets. */}
                                    <li className={itemClass}>
                                        <MessagesLink />
                                    </li>
                                    {/* A provider is a traveller too: their own
                                        stays and booked experiences, one place. */}
                                    <li className={itemClass}>
                                        <Link href='/trips'>Your trips</Link>
                                    </li>
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
                                        time. */}
                                    {isHost && <BookingsLink onlyWhenWaiting />}
                                </>
                            )}

                            <li className={itemClass}>
                                <Link href='/account'>Account settings</Link>
                            </li>

                            {isAdmin && (
                                <>
                                    <div className='border-t my-1' />
                                    <li className={itemClass}>
                                        <Link href='/admin' className='font-semibold text-emerald-800'>
                                            Owner tools
                                        </Link>
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
