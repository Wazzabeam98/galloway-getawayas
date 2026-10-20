import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TRADES, tradeLabel, tradeNoun, indefiniteArticle, canBeEnquiredAbout } from '@/lib/serviceProviders';

// Absolute base for structured data, the same origin the area and listing
// pages use. Defined here rather than imported from lib/email so this route
// carries no dependency on the mail layer.
const SITE_URL = 'https://gallowaygetaways.co.uk';

// There is no per-trade LIST page any more — /services/<trade> is a permanent
// redirect to /services?trade=<trade> (next.config.js). What this layout still
// wraps is the public profile of one tradesperson, /services/<trade>/<id>,
// which sets its own title and noindex but inherits the description and the
// Service structured data below. So both are live copy, and both describe what
// the directory actually does now: a list you filter by area and trade, where
// you see who they are and what they charge and ask one. There is no ordering
// by distance and no canonical pointing at the old per-trade URL.
//
// Originally this fixed two things.
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

// One sentence for both the meta description and the Service description, so
// they cannot drift apart. The worker noun, not the label — "a window cleaner",
// never "a window cleaning".
function describeTrade(trade: string): string {
  const noun = tradeNoun(trade);
  return `Find ${indefiniteArticle(noun)} ${noun} covering holiday lets across Dumfries & Galloway. `
    + 'See who they are and what they charge, then ask one — you agree the job and pay them directly.';
}

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
  // placeholder (cleaning, the one host trade not open yet), and /services/guest only redirects away.
  // Neither has content a search result should land on, and an indexed thin
  // page drags the rest of the domain down — so they are kept out of the
  // index. follow stays on so a crawler still uses the links out of them.
  if (!canBeEnquiredAbout(params.trade)) {
    return {
      title: `${label} for holiday lets in Dumfries & Galloway`,
      robots: { index: false, follow: true },
    };
  }

  return {
    title: `${label} for holiday lets in Dumfries & Galloway`,
    description: describeTrade(params.trade),
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

  // No structured data here. It used to be a generic Service block for the
  // per-trade list page; that page is gone (a redirect), and on the one route
  // this layout still wraps — a tradesperson's own profile — it described the
  // list instead of the business. The profile page emits its own
  // LocalBusiness now.
  return (
    <>
      {children}
    </>
  );
}
