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

const itemClass = 'hover:bg-slate-200 rounded-md p-2 cursor-pointer';

const NavMenu = ({
    session,
    isHost = false,
    mode = 'travel',
}: {
    session: object | undefined;
    isHost?: boolean;
    mode?: 'host' | 'travel';
}) => {
    const hostView = isHost && mode === 'host';

    return (
        <Popover>
            <PopoverTrigger asChild>
                <div className='flex space-x-2 border p-2 rounded-full cursor-pointer'>
                    <MenuIcon className='cursor-pointer' />
                    <UserIcon className='cursor-pointer' />
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
