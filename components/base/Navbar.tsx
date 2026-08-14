import NavMenu from '@/components/base/NavMenu';
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import Link from 'next/link';
import Logo from '@/components/base/Logo';

const Navbar = async () => {
    const supabase = createServerComponentClient({ cookies });
    const { data } = await supabase.auth.getSession();

    let displayName: string | null = null;
    if (data?.session?.user) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, preferred_name')
            .eq('id', data.session.user.id)
            .single();
        const rawName = profile?.preferred_name || profile?.full_name || data.session.user.email?.split('@')[0];
        displayName = rawName ? rawName.split(' ')[0] : null;
    }

    return (
        <nav className='w-full border-b bg-white sticky top-0 z-50'>
            <div className='max-w-7xl mx-auto px-6 md:px-10 h-20 flex items-center justify-between'>
                <div className='flex items-center'>
                    <Logo />
                </div>
                <div className='flex items-center space-x-6'>
                    {displayName && (
                        <Link href="/account" className="text-sm font-semibold text-slate-800 hidden sm:block hover:underline">
                            Welcome, {displayName}
                        </Link>
                    )}
                    <Link href="/addhome" className="text-sm font-semibold hover:bg-slate-100 rounded-full py-2 px-4 transition text-slate-800">
                        Become a host
                    </Link>
                    <NavMenu session={data?.session?.user} />
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
