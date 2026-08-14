import NavMenu from '@/components/base/NavMenu';
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import Link from 'next/link';
import Logo from '@/components/base/Logo';
import ModeSwitch from '@/components/base/ModeSwitch';
import { displayName as resolveName } from '@/lib/utils';

const Navbar = async () => {
    const cookieStore = cookies();
    const supabase = createServerComponentClient({ cookies });
    const { data } = await supabase.auth.getSession();

    let firstName: string | null = null;
    let isHost = false;

    if (data?.session?.user) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, preferred_name')
            .eq('id', data.session.user.id)
            .single();

        // Your own name — always your real one. The privacy setting governs
        // what OTHER people see about you, not what you see about yourself.
        const rawName =
            profile?.preferred_name ||
            profile?.full_name ||
            data.session.user.email?.split('@')[0];
        firstName = rawName ? rawName.split(' ')[0] : null;

        // You're a host if you actually have a listing — drafts count, since
        // you're mid-way through becoming one. Deriving it this way means it
        // can never fall out of step with reality.
        const { count } = await supabase
            .from('listings')
            .select('id', { count: 'exact', head: true })
            .eq('host_id', data.session.user.id);

        isHost = (count || 0) > 0;
    }

    // Default a host to travel mode until they choose otherwise.
    const modeCookie = cookieStore.get('gg_mode')?.value;
    const mode: 'host' | 'travel' = modeCookie === 'host' ? 'host' : 'travel';

    return (
        <nav className='w-full border-b bg-white sticky top-0 z-50'>
            <div className='max-w-7xl mx-auto px-6 md:px-10 h-20 flex items-center justify-between'>
                <div className='flex items-center'>
                    <Logo />
                </div>
                <div className='flex items-center space-x-6'>
                    {firstName && (
                        <Link href="/account" className="text-sm font-semibold text-slate-800 hidden sm:block hover:underline">
                            Welcome, {firstName}
                        </Link>
                    )}

                    {isHost ? (
                        <div className='hidden sm:block'>
                            <ModeSwitch mode={mode} />
                        </div>
                    ) : (
                        <Link href="/addhome" className="text-sm font-semibold hover:bg-slate-100 rounded-full py-2 px-4 transition text-slate-800">
                            Become a host
                        </Link>
                    )}

                    <NavMenu session={data?.session?.user} isHost={isHost} mode={mode} />
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
