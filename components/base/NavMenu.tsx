import React from 'react'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { UserIcon } from 'lucide-react'
import LoginModel from '../auth/LoginModel'
import SignupModel from '../auth/SignupModel'
import SignOut from '../common/SignOut'
import ModeSwitch from './ModeSwitch'
import Link from 'next/link'
import { getImageUrl } from '@/lib/utils'
import MessagesLink from './MessagesLink'
import MenuUnreadDot from './MenuUnreadDot'
import BookingsLink from './BookingsLink'

const itemClass = 'hover:bg-slate-200 rounded-md p-2 cursor-pointer';

const NavMenu = ({
    session,
    isHost = false,
    isAdmin = false,
    mode = 'travel',
    hasCompletedStay = false,
    isProvider = false,
    avatarUrl = null,
    initial = '',
}: {
    session: object | undefined;
    isHost?: boolean;
    isAdmin?: boolean;
    mode?: 'host' | 'travel';
    hasCompletedStay?: boolean;
    isProvider?: boolean;
    avatarUrl?: string | null;
    initial?: string;
}) => {
    const hostView = isHost && mode === 'host';

    return (
        <Popover>
            <PopoverTrigger asChild>
                <div className='flex items-center gap-2 border p-1.5 pl-3 rounded-full cursor-pointer hover:shadow-md transition'>
                    <MenuUnreadDot enabled={session != null} host={isHost} />
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
                </div>
            </PopoverTrigger>
            <PopoverContent className='mr-6'>
                <ul>
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
                                </>
                            ) : isProvider ? (
                                /* A provider's menu is their business, not a
                                   traveller's. A plumber signing in is not
                                   looking for a cottage, so "Your trips" and
                                   "Become a host" give way to their own things.
                                   (A provider who is also a host still gets the
                                   full host menu in host mode, above.) */
                                <>
                                    <li className={itemClass}>
                                        <Link href='/services/dashboard' className='font-semibold text-emerald-800'>
                                            Your business
                                        </Link>
                                    </li>
                                    <li className={itemClass}>
                                        <Link href='/services/dashboard#requests'>Enquiries</Link>
                                    </li>
                                    <li className={itemClass}>
                                        <Link href='/services/dashboard/edit'>Your profile</Link>
                                    </li>
                                    {/* A tradesman's messages are his job threads,
                                        not booking chat — a home he can navigate to
                                        so a thread is never a lost email. */}
                                    <li className={itemClass}>
                                        <Link href='/services/messages'>Messages</Link>
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
                                    {isHost && (
                                        <li className={itemClass}>
                                            <BookingsLink onlyWhenWaiting />
                                        </li>
                                    )}
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
                                /* A tradesman isn't a lapsed host to convert —
                                   no "Become a host" nudge in his menu. */
                                null
                            ) : (
                                <li className={itemClass}>
                                    <Link href='/addhome'>Become a host</Link>
                                </li>
                            )}

                            <SignOut />
                        </>
                    ) : (
                        <>
                            <LoginModel />
                            <SignupModel />
                            <li className={itemClass}>
                                <Link href='/addhome'>Become a host</Link>
                            </li>
                        </>
                    )}
                </ul>
            </PopoverContent>
        </Popover>
    )
}

export default NavMenu
