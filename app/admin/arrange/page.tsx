import Link from 'next/link';
import { requireAdmin } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { orderPublishedListings } from '@/lib/listingOrder';
import { loadPublicMarketplace } from '@/lib/experiencesData';
import ArrangeBoard, { type ArrangeItem } from '@/components/admin/ArrangeBoard';

export const dynamic = 'force-dynamic';

// The admin "Arrange listings" page. Drag the published cottages — or, on its
// own tab, the live experiences — into the order the grids should show them.
// Saving writes display_order (app/api/admin/arrange) and every public grid reads
// that order (lib/listingOrder): the home "Our Properties" grid, the search and
// area pages, and the experiences browse page. New listings sit at the bottom
// until they are moved.

async function listingItems(): Promise<ArrangeItem[]> {
    const admin = adminClient();
    const { data } = await orderPublishedListings(
        admin
            .from('listings')
            .select('id, title, location, images, display_order')
            .eq('status', 'published'),
    );
    return (data || []).map((l: any): ArrangeItem => ({
        id: l.id,
        title: l.title || 'Untitled',
        subtitle: l.location || '',
        image: Array.isArray(l.images) && l.images.length ? l.images[0] : null,
        href: `/homes/${l.id}`,
        placed: l.display_order != null,
    }));
}

async function experienceItems(): Promise<ArrangeItem[]> {
    // The same loader the public browse grid uses, so this list is exactly what a
    // guest sees, in the same order (lib/experiencesData, already sorted by
    // display_order). `open: true` so admins can arrange it before launch too.
    const mp = await loadPublicMarketplace(adminClient(), true);
    return mp.providers.map((p): ArrangeItem => ({
        id: p.id,
        title: p.business_name || 'Untitled',
        subtitle: p.byline || p.category || (p.areas[0] || ''),
        image: p.hero || p.headshot || null,
        href: `/experiences/browse/${p.id}`,
        placed: p.display_order != null,
    }));
}

export default async function ArrangePage({
    searchParams,
}: {
    searchParams: { kind?: string };
}) {
    await requireAdmin();

    const kind = searchParams.kind === 'experiences' ? 'experiences' : 'listings';
    const items = kind === 'experiences' ? await experienceItems() : await listingItems();

    const tabs: { key: 'listings' | 'experiences'; label: string; href: string }[] = [
        { key: 'listings', label: 'Properties', href: '/admin/arrange' },
        { key: 'experiences', label: 'Experiences', href: '/admin/arrange?kind=experiences' },
    ];

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-3xl px-6 py-10">
                <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-900">← Owner tools</Link>
                <h1 className="mb-1 mt-3 text-2xl font-bold text-slate-900">Arrange listings</h1>
                <p className="mb-6 text-sm text-slate-500">
                    Drag a row — or use the ▲▼ buttons — into the order you want. The best show first,
                    everywhere they appear. Then press Save.
                </p>

                <div className="mb-6 inline-flex rounded-full border border-slate-200 bg-white p-1">
                    {tabs.map((t) => (
                        <Link
                            key={t.key}
                            href={t.href}
                            className={'rounded-full px-4 py-1.5 text-sm font-medium transition '
                                + (t.key === kind ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900')}
                        >
                            {t.label}
                        </Link>
                    ))}
                </div>

                <ArrangeBoard kind={kind} items={items} />
            </div>
        </div>
    );
}
