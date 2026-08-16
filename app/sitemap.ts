import { createClient } from '@supabase/supabase-js';
import type { MetadataRoute } from 'next';
import Env from '@/config/Env';

const SITE_URL = 'https://gallowaygetaways.co.uk';

// The root layout sets force-dynamic, which cascades to every route.
// Setting revalidate here as well is a conflict, so this matches the
// layout instead and is generated per request.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    { url: `${SITE_URL}/contact`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.4 },
    { url: `${SITE_URL}/terms`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/privacy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/cancellation-policy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.4 },
  ];

  try {
    const supabase = createClient(Env.SUPABASE_URL, Env.SUPABASE_KEY);

    // Only published listings — drafts shouldn't be indexed.
    const { data: listings } = await supabase
      .from('listings')
      .select('id, created_at, status')
      .eq('status', 'published');

    const listingPages: MetadataRoute.Sitemap = (listings || []).map((listing) => ({
      url: `${SITE_URL}/homes/${listing.id}`,
      lastModified: listing.created_at ? new Date(listing.created_at) : new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));

    return staticPages.concat(listingPages);
  } catch (err) {
    // A sitemap that fails shouldn't take the site down — return the
    // homepage and let the next rebuild pick up the listings.
    console.error('Could not build sitemap:', err);
    return staticPages;
  }
}
