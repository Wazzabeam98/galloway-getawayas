import NavMenu from '@/components/base/NavMenu';
import { londonDayKey } from '@/lib/dayKey';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import Link from 'next/link';
import Logo from '@/components/base/Logo';
import ModeSwitch from '@/components/base/ModeSwitch';
import { displayName as resolveName, getImageUrl } from '@/lib/utils';
import RememberAccount from '@/components/auth/RememberAccount';
import { NO_WORK_SIDE, resolveWorkMode, WorkSide } from '@/lib/workMode';
import { readWorkSide } from '@/lib/workSide';

const Navbar = async () => {
    const cookieStore = cookies();
    const supabase = createServerComponentClient({ cookies });
    const { data } = await supabase.auth.getSession();

    let firstName: string | null = null;
    let isHost = false;
    let avatarUrl: string | null = null;
    let isAdmin = false;
    let hasCompletedStay = false;
    let isProvider = false;
    let providerAudience: string | null = null;
    let side: WorkSide = NO_WORK_SIDE;

    if (data?.session?.user) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, preferred_name, avatar_url, is_admin')
            .eq('id', data.session.user.id)
            .single();

        // Your own name — always your real one. The privacy setting governs
        // what OTHER people see about you, not what you see about yourself.
        const rawName =
            profile?.preferred_name ||
            profile?.full_name ||
            data.session.user.email?.split('@')[0];
        firstName = rawName ? rawName.split(' ')[0] : null;
        avatarUrl = profile?.avatar_url || null;
        isAdmin = profile?.is_admin === true;

        // What they can work as — a host (any listing, drafts included, shows
        // the switch), an approved host, an approved provider (lib/workSide).
        const read = await readWorkSide(supabase, data.session.user.id);
        side = read;
        isHost = read.isHost;
        isProvider = read.isProvider;
        providerAudience = read.providerAudience;

        // The passport is made of finished stays, so it is empty until there
        // is one. Same rule the passport page itself uses — a confirmed
        // booking whose check-out has been and gone — so the menu link never
        // leads to a blank page.
        const today = londonDayKey();
        const { count: stays } = await supabase
            .from('bookings')
            .select('id', { count: 'exact', head: true })
            .eq('guest_id', data.session.user.id)
            .eq('status', 'confirmed')
            .lt('check_out', today);

        hasCompletedStay = (stays || 0) > 0;
    }

    // The one gg_mode cookie remembers the side they were last on, for everyone
    // with two sides; never having chosen, an approved host or provider is on
    // their working side and everyone else is travelling. Same rule as the
    // homepage and the landing step after sign-in (lib/workMode).
    const mode = resolveWorkMode(cookieStore.get('gg_mode')?.value, side);

    // Experiences are a public destination once the feature is live — anyone can
    // browse, signed in or not — so the link is shown to everyone, gated only on
    // the launch flag. Dormant (nothing shown) while it is unset.
    const experiencesOpen = guestExperiencesOpen();

    return (
        <nav className='w-full border-b bg-white sticky top-0 z-50'>
            <div className='max-w-7xl mx-auto px-6 md:px-10 h-20 flex items-center justify-between'>
                <div className='flex items-center gap-6'>
                    <Logo />
                    {experiencesOpen && (
                        <Link
                            href="/experiences/browse"
                            className="hidden sm:block text-sm font-semibold text-slate-800 hover:text-emerald-800 transition"
                        >
                            Experiences
                        </Link>
                    )}
                </div>
                {/* gap, not space-x: space-x puts its margin on every child
                    after the first, hidden ones included, so the phone-hidden
                    "Welcome" link added a phantom 24px the moment anyone signed
                    in. That, plus the logo, "Start hosting" and the menu not
                    fitting a 320px screen, made the page wider than an iPhone —
                    and iOS Safari then shows every page zoomed and panned right.
                    gap counts only what is displayed; it tightens on phones. */}
                <div className='flex items-center gap-3 sm:gap-6'>
                    {firstName && (
                        <Link href="/account" className="text-sm font-semibold text-slate-800 hidden sm:block hover:underline">
                            Welcome, {firstName}
                        </Link>
                    )}

                    {isHost ? (
                        <div className='hidden sm:block'>
                            <ModeSwitch mode={mode} />
                        </div>
                    ) : isProvider ? (
                        /* A provider — a trade or an experience host — has a
                           providing side and a travelling side, the same two
                           sides an accommodation host has. Same switch, pointed
                           at their provider dashboard and worded in their own
                           noun ("providing"), not "hosting". A host who is also a
                           provider keeps the host switch above. */
                        <div className='hidden sm:block'>
                            <ModeSwitch mode={mode} workHref='/services/dashboard' workLabel='providing' />
                        </div>
                    ) : (
                        // Off below 360px: the logo, this and the menu need ~355px
                        // and would push the page sideways. It is in the menu too.
                        <Link href="/business" className="hidden min-[360px]:block text-sm font-semibold hover:bg-slate-100 rounded-full py-2 px-4 transition text-slate-800">
                            Start hosting
                        </Link>
                    )}

                    {data?.session?.user && (
                        <RememberAccount
                            firstName={firstName}
                            avatarUrl={avatarUrl ? getImageUrl(avatarUrl) : null}
                            email={data.session.user.email}
                            phone={data.session.user.phone}
                        />
                    )}
                    <NavMenu
                        session={data?.session?.user}
                        experiencesOpen={experiencesOpen}
                        isHost={isHost}
                        isAdmin={isAdmin}
                        mode={mode}
                        hasCompletedStay={hasCompletedStay}
                        isProvider={isProvider}
                        providerAudience={providerAudience}
                        avatarUrl={avatarUrl}
                        initial={firstName ? firstName.charAt(0).toUpperCase() : ''}
                    />
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
