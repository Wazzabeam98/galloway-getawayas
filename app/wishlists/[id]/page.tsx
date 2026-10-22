import type { Metadata } from 'next';
import WishlistDetail from '@/components/wishlists/WishlistDetail';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Wishlist · Galloway Getaways',
    robots: { index: false },
};

// The id is only passed to a client component that loads the owner's own rows
// under RLS; nothing private is read or rendered on the server.
export default function WishlistPage({ params }: { params: { id: string } }) {
    return (
        <main className="min-h-screen bg-slate-50">
            <div className="max-w-6xl mx-auto px-6 py-10">
                <WishlistDetail id={params.id} />
            </div>
        </main>
    );
}
