import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TRADES, tradeLabel } from '@/lib/serviceProviders';

// app/services/[trade]/page.tsx is a client component and cannot export
// metadata, so it lives here. Two things this fixes.
//
// EVERY TRADE PAGE HAD THE HOME PAGE'S TITLE. Fourteen public pages sharing
// one title and one description is fourteen pages Google cannot tell apart.
//
// AN UNKNOWN TRADE ANSWERED 200. tradeLabel() falls back to the word
// "Service", so /services/cleaner and /services/anything-at-all both rendered
// a real-looking page with a real status code — an unlimited supply of soft
// 404s for a crawler to find and index. The keys are a closed list, so the
// page can simply say no to anything not on it.

const KEYS: string[] = TRADES.map((t) => t.key);

export async function generateMetadata({
  params,
}: {
  params: { trade: string };
}): Promise<Metadata> {
  if (KEYS.indexOf(params.trade) === -1) {
    return { title: 'Not found', robots: { index: false, follow: false } };
  }

  const label = tradeLabel(params.trade);

  return {
    title: `${label} for holiday lets in Dumfries & Galloway`,
    description:
      `Find a ${label.toLowerCase()} covering your holiday let in Dumfries & Galloway. `
      + 'Ordered by how close they are to your property, and nothing else.',
    alternates: { canonical: `/services/${params.trade}` },
  };
}

export default function TradeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { trade: string };
}) {
  if (KEYS.indexOf(params.trade) === -1) notFound();
  return <>{children}</>;
}
