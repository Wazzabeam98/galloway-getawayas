import type { Metadata } from 'next';

// app/addhotel/page.tsx is a client component and cannot export metadata; a
// layout is a server component, so the title and the noindex live here. Mirrors
// app/addhome/layout.tsx: the wizard stays out of search (robots.ts also
// disallows /addhotel — the two agreeing is what actually keeps it unindexed, as
// robots.txt alone does not stop indexing from an inbound link).
// The wizard reads ?draft and autosaves, so the segment is dynamic (also keeps
// useSearchParams out of static prerendering).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'List your hotel',
  description:
    'Add your Dumfries & Galloway hotel to Galloway Getaways. Take room bookings '
    + 'direct, with no platform fee for your guests.',
  robots: { index: false, follow: false },
};

export default function AddHotelLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
