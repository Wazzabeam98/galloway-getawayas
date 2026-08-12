export const dynamic = 'force-dynamic';

import NavMenu from '@/components/base/NavMenu';
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import Link from 'next/link';
import Logo from '@/components/base/Logo';

const Navbar = async () => {
    const supabase = createServerComponentClient({ cookies });
    const { data } = await supabase.auth.getSession();
    
    return (
        <div className='flex items-center justify-between px-6 md:px-10 py-4 border-b-[1px] bg-white sticky top-0 z-50'>
            <div>
                <Logo />
            </div>
            <div className='flex items-center space-x-6'>
                <Link href="/addhome" className="text-sm font-semibold hover:bg-slate-100 rounded-full py-2 px-4 transition">
                    Become a host
                </Link>
                <NavMenu session={data?.session?.user} />
            </div>
        </div>
    )
}

export default Navbar;