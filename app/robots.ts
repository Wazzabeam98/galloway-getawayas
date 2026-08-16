import type { MetadataRoute } from 'next';

const SITE_URL = 'https://gallowaygetaways.co.uk';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Nothing behind a login should be crawled — it wastes Google's
        // time on this site and none of it is useful in search results.
        disallow: [
          '/account',
          '/dashboard',
          '/messages',
          '/trips',
          '/services',
          '/addhome',
          '/edit-listing',
          '/api/',
          '/auth/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
