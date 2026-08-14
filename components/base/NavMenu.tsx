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
import Link from 'next/link'

const NavMenu = ({ session }: { session: object | undefined }) => {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <div className='flex space-x-2 border p-2 rounded-full'>
                    <MenuIcon className='cursor-pointer' />
                    <UserIcon className='cursor-pointer' />
                </div>
            </PopoverTrigger>
            <PopoverContent className='mr-6'>
                <ul>
                    {session != null ? (
                        <>
                            <li className='hover:bg-slate-200 rounded-md p-2 cursor-pointer'>
                                <Link href='/trips'>
                                    Your trips
                                </Link>
                            </li>
                            <li className='hover:bg-slate-200 rounded-md p-2 cursor-pointer'>
                                <Link href='/messages'>
                                    Messages
                                </Link>
                            </li>
                            <li className='hover:bg-slate-200 rounded-md p-2 cursor-pointer'>
                                <Link href='/dashboard'>
                                    Listings
                                </Link>
                            </li>
                            <li className='hover:bg-slate-200 rounded-md p-2 cursor-pointer'>
                                <Link href='/dashboard/bookings'>
                                    Bookings
                                </Link>
                            </li>
                            <li className='hover:bg-slate-200 rounded-md p-2 cursor-pointer'>
                                <Link href='/dashboard/calendar'>
                                    Calendar
                                </Link>
                            </li>
                            <li className='hover:bg-slate-200 rounded-md p-2 cursor-pointer'>
                                <Link href='/dashboard/reviews'>
                                    Reviews
                                </Link>
                            </li>
                            <li className='hover:bg-slate-200 rounded-md p-2 cursor-pointer'>
                                <Link href='/dashboard/earnings'>
                                    Earnings
                                </Link>
                            </li>
                            <li className='hover:bg-slate-200 rounded-md p-2 cursor-pointer'>
                                <Link href='/account'>
                                    Account settings
                                </Link>
                            </li>
                            <SignOut />
                            <li className="hover:bg-slate-200 rounded-md p-2 cursor-pointer">
                                <Link href="/addhome" >
                                    Become a host
                                </Link>
                            </li>
                        </>
                    ) : (
                        <>
                            <LoginModel />
                            <SignupModel />
                            <li className="hover:bg-slate-200 rounded-md p-2 cursor-pointer">
                                <Link href="/addhome" >
                                    Become a host
                                </Link>
                            </li>
                        </>
                    )}
                </ul>
            </PopoverContent>
        </Popover>

    )
}

export default NavMenu
