import React from 'react'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { MenuIcon, UserIcon } from 'lucide-react'
import LoginModel from '../auth/LoginModel'
import SignupModel from '../auth/SignupModel'
import SignOut from '../common/SignOut'
import ModeSwitch from './ModeSwitch'
import Link from 'next/link'
import { getImageUrl } from '@/lib/utils'

const itemClass = 'hover:bg-slate-200 rounded-md p-2 cursor-pointer';

const NavMenu = ({
    session,
    isHost = false,
    isAdmin = false,
    mode = 'travel',
    avatarUrl = null,
    initial = '',
}: {
    session: object | undefined;
    isHost?: boolean;
    isAdmin?: boolean;
    mode?: 'host' | 'travel';
    avatarUrl?: string | null;
    initial?: string;
}) => {
    const hostView = isHost && mode === 'host';

    return (
        <Popover>
            <PopoverTrigger asChild>
                <div className='flex items-center gap-2 border p-1.5 pl-3 rounded-full cursor-pointer hover:shadow-md transition'>
                    <MenuIcon className='w-5 h-5' />
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
                                        <Link href='/dashboard/bookings'>Bookings</Link>
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
                                        <Link href='/dashboard/people'>People</Link>
                                    </li>
                                    <li className={itemClass}>
                                        <Link href='/services'>Services</Link>
                                    </li>
                                    <li className={itemClass}>
                                        <Link href='/messages'>Messages</Link>
                                    </li>
                                </>
                            ) : (
                                <>
                                    <li className={itemClass}>
                                        <Link href='/trips'>Your trips</Link>
                                    </li>
                                    <li className={itemClass}>
                                        <Link href='/messages'>Messages</Link>
                                    </li>
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
                                        className='w-full text-left'
                                    />
                                </li>
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
