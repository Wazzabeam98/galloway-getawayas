import type { Metadata } from 'next';

// app/addhome/page.tsx is a client component, and a client component cannot
// export metadata — which is why every share of this link, and every browser
// tab it opened, said "Self Catering Holiday Cottages in Dumfries & Galloway"
// instead of what the page is. A layout is a server component, so it can.
//
// noindex matches robots.ts, which disallows /addhome. The two agreeing
// matters: robots.txt stops the page being crawled, it does not stop it being
// indexed from a link somewhere else, and only this tag does that.
//
// Worth revisiting as a decision rather than as a bug. See SITE-AUDIT.md:
// the wizard itself should stay out of search, but a real "list your property"
// landing page in front of it should not.
export const metadata: Metadata = {
  title: 'List your property',
  description:
    'Add your Dumfries & Galloway holiday let to Galloway Getaways. '
    + 'Keep more of what your guests pay, and take bookings direct.',
  robots: { index: false, follow: false },
};

export default function AddHomeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
