import type { Metadata } from 'next';
import WishlistsIndex from '@/components/wishlists/WishlistsIndex';

// Private per-viewer page: it reads no session on the server and renders nothing
// user-specific — the client component loads the person's own wishlists under
// RLS. force-dynamic keeps it off the static/ISR cache for good measure.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Wishlists · Galloway Getaways',
    robots: { index: false },
};

export default function WishlistsPage() {
    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-6xl mx-auto px-6 py-10">
                <WishlistsIndex />
            </div>
        </main>
    );
}
