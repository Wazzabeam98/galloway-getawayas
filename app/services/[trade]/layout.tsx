import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TRADES, tradeLabel, canBeEnquiredAbout } from '@/lib/serviceProviders';

// Absolute base for structured data, the same origin the area and listing
// pages use. Defined here rather than imported from lib/email so this route
// carries no dependency on the mail layer.
const SITE_URL = 'https://gallowaygetaways.co.uk';

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

  // A known trade that isn't in the shop yet renders a "Not this one yet"
  // placeholder (sponge/bin/trees), and /services/guest only redirects away.
  // Neither has content a search result should land on, and an indexed thin
  // page drags the rest of the domain down — so they are kept out of the
  // index. follow stays on so a crawler still uses the links out of them.
  if (!canBeEnquiredAbout(params.trade)) {
    return {
      title: `${label} for holiday lets in Dumfries & Galloway`,
      robots: { index: false, follow: true },
      alternates: { canonical: `/services/${params.trade}` },
    };
  }

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

  // Service structured data on the seven real trade pages. It tells Google the
  // page is a service (an <trade> covering holiday lets) offered across
  // Dumfries & Galloway, which is how these pages can win the local result.
  // Only the enquirable trades get it — the placeholder and redirect slugs are
  // noindex (see generateMetadata) and have nothing to describe.
  const label = tradeLabel(params.trade);
  const serviceSchema = canBeEnquiredAbout(params.trade)
    ? {
        '@context': 'https://schema.org',
        '@type': 'Service',
        serviceType: label,
        name: `${label} for holiday lets in Dumfries & Galloway`,
        description:
          `Find a ${label.toLowerCase()} covering your holiday let in `
          + 'Dumfries & Galloway, ordered by how close they are to your property.',
        provider: {
          '@type': 'Organization',
          name: 'Galloway Getaways',
          url: SITE_URL,
        },
        areaServed: {
          '@type': 'AdministrativeArea',
          name: 'Dumfries & Galloway',
        },
        url: `${SITE_URL}/services/${params.trade}`,
      }
    : null;

  return (
    <>
      {serviceSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }}
        />
      )}
      {children}
    </>
  );
}
