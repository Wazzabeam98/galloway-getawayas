// Edge-cached (ISR). A public host profile is the same for everyone — a first
// name, a photo, a join year, the reviews guests have left and the host's own
// published listings. Nothing on it reads the session, so it is served from
// Vercel's cache and rebuilt in the background, exactly like the listing and
// experience pages. Every piece of data is read through the service role and
// only public fields reach the HTML (see lib/hostProfile) — no surname, no
// contact detail, no address — so no cached copy can hold anyone's private
// details. A listing, experience or profile save refreshes the page on the spot
// via lib/revalidatePublic (revalidateHostProfile); 300s is the fallback.
export const revalidate = 300;

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { adminClient } from '@/lib/supabaseAdmin';
import { hostByline, capitializeFirst } from '@/lib/utils';
import { loadHostProfile } from '@/lib/hostProfile';
import HostProfileView from './HostProfileView';
import { SITE_URL } from '@/app/homes/[id]/HomeView';

// Pre-render every host who has something public — a published listing or an
// approved experience. Returned as [] without Supabase env so `next build` in CI
// (which has no env) passes; dynamicParams defaults true, so a host published
// after the build renders on demand and caches from then.
export async function generateStaticParams(): Promise<{ id: string }[]> {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
    try {
        const admin = adminClient();
        const ids = new Set<string>();
        const { data: hosts } = await admin
            .from('listings')
            .select('host_id')
            .eq('status', 'published');
        (hosts || []).forEach((l: any) => l.host_id && ids.add(String(l.host_id)));
        const { data: owners } = await admin
            .from('service_providers')
            .select('owner_id')
            .eq('audience', 'guest')
            .eq('status', 'approved')
            .eq('owner_paused', false)
            .is('admin_hidden_at', null);
        (owners || []).forEach((p: any) => p.owner_id && ids.add(String(p.owner_id)));
        return Array.from(ids).map((id) => ({ id }));
    } catch {
        return [];
    }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
    const notFoundMeta: Metadata = {
        title: 'Host not found',
        description: 'This host profile is no longer available.',
        robots: { index: false, follow: false },
    };

    // Cookieless (service role) so the metadata builds statically. Only the name
    // columns are read, resolved to a first name here; nothing private is put in
    // the tags. A missing or closed account gets the reveals-nothing metadata.
    const { data: profile } = await adminClient()
        .from('profiles')
        .select('first_name, last_name, preferred_name, show_full_name, trading_name, full_name, anonymised_at, deactivated_at')
        .eq('id', params.id)
        .maybeSingle();
    if (!profile || profile.anonymised_at || profile.deactivated_at) return notFoundMeta;

    const byline = hostByline(profile, null, 'Host');
    const name = byline === 'Host' ? 'This host' : capitializeFirst(byline);
    const title = `${name} — host on Galloway Getaways`;
    const description = `${name} hosts self-catering stays in Dumfries & Galloway with Galloway Getaways. See their places, reviews and how long they've been hosting.`;

    return {
        title,
        description,
        alternates: { canonical: `/hosts/${params.id}` },
        openGraph: {
            type: 'profile',
            locale: 'en_GB',
            url: `${SITE_URL}/hosts/${params.id}`,
            siteName: 'Galloway Getaways',
            title,
            description,
            images: [{ url: `${SITE_URL}/images/og-default.jpg`, width: 1200, height: 630, alt: title }],
        },
        twitter: { card: 'summary', title, description },
    };
}

export default async function HostProfilePage({ params }: { params: { id: string } }) {
    // A null profile — missing, closed, or nothing published — is a 404, so no
    // empty profile is ever cached and no URL resolves to someone with nothing
    // public to show.
    const profile = await loadHostProfile(params.id);
    if (!profile) notFound();
    return <HostProfileView profile={profile} />;
}
