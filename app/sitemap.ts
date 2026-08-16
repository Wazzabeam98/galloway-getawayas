import { createClient } from '@supabase/supabase-js';
import type { MetadataRoute } from 'next';
import Env from '@/config/Env';

const SITE_URL = 'https://gallowaygetaways.co.uk';

// Rebuilt every hour rather than on every request, so a crawler hitting
// this repeatedly doesn't hammer the database.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
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
