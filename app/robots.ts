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
        //
        // These are PREFIX rules, which is what made the old '/services'
        // entry wrong: /services and /services/<trade> are public shop-front
        // pages that anyone can read, and one line was hiding the whole
        // directory from search along with the sign-up funnel underneath it.
        // Only the funnel is disallowed now.
        //
        // The token pages (/e/, /invite/, /trip-invite/, /services/enquiry/)
        // are unguessable rather than logged in, so nothing stops a crawler
        // that has seen one — usually because the address was pasted
        // somewhere — from fetching and indexing it. They are named here for
        // the same reason /messages is.
        disallow: [
          '/account',
          '/dashboard',
          '/messages',
          '/trips',
          '/passport',
          '/services/join',
          '/services/enquiry',
          '/addhome',
          '/edit-listing',
          '/booking-confirmed',
          '/review/',
          '/invite/',
          '/trip-invite/',
          '/e/',
          '/unsubscribe',
          '/admin',
          '/api/',
          '/auth/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
