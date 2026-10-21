import { guestExperiencesOpen } from '@/lib/serviceOrders';
import Link from 'next/link';
import Logo from '@/components/base/Logo';
import NavUser from '@/components/base/NavUser';

// The site header. It renders the SAME markup for everyone — the logo, the
// Experiences link and a per-viewer right-hand side (NavUser) — so the layout,
// and therefore every public page, can be edge-cached. NavUser renders the
// signed-out shell on the server and fetches the signed-in bits (Welcome, the
// mode switch, the account menu) on the client after load. The navbar used to be
// an async server component that read the session on every request, which forced
// every page to render per-request; moving that read to /api/nav is what lets the
// shop-front pages cache. Nothing personal is in the server HTML.
const Navbar = () => {
    // Experiences are a public destination once the feature is live — a launch
    // flag that is the same for everyone (not per-viewer), so it stays on the
    // server. Dormant (nothing shown) while it is unset.
    const experiencesOpen = guestExperiencesOpen();

    return (
        <nav className="w-full border-b bg-white sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-6 md:px-10 h-20 flex items-center justify-between">
                <div className="flex items-center gap-6">
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
                {/* gap, not space-x: gap counts only what is displayed, so a
                    phone-hidden child adds no phantom width. */}
                <NavUser experiencesOpen={experiencesOpen} />
            </div>
        </nav>
    );
};

export default Navbar;
