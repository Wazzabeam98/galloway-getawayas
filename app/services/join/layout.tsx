import type { Metadata } from 'next';

// The sign-up funnel for tradespeople. Client components underneath, so the
// title has to be set here. noindex to match robots.ts — /services and
// /services/<trade> are the public shop front and stay indexable; this is the
// form behind it and is not a search result anybody wants.
export const metadata: Metadata = {
  title: 'Join as a trade',
  description:
    'Get work from holiday lets across Dumfries & Galloway. '
    + 'Tell us what you do and where you cover.',
  robots: { index: false, follow: false },
};

export default function ServicesJoinLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
