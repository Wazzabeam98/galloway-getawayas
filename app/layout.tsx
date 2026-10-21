import './globals.css';
import 'react-toastify/dist/ReactToastify.css';
import Navbar from '@/components/base/Navbar';
import Footer from '@/components/base/Footer';
import FooterMinimal from '@/components/base/FooterMinimal';
import FooterSwitch from '@/components/base/FooterSwitch';
import ChromeGate from '@/components/base/ChromeGate';
import { ToastContainer } from 'react-toastify';
import { Suspense } from 'react';
import Toast from '@/components/base/Toast';
import AuthPanelHost from '@/components/auth/AuthPanel';
import FinishSignUpGate from '@/components/auth/FinishSignUpGate';
import KeepSignedIn from '@/components/auth/KeepSignedIn';
import PwaSetup from '@/components/pwa/PwaSetup';
import InstallHint from '@/components/pwa/InstallHint';
import { Analytics } from '@vercel/analytics/next';
import { socialUrls } from '@/config/social';
import { COMPANY } from '@/config/company';
import type { Metadata } from 'next';
import ViewportLock from '@/components/base/ViewportLock';
import localFont from 'next/font/local';

// One typeface on every device: variable Roboto, the face Android draws the
// site in. With no font of its own the site fell back to each phone's system
// font, and an iPhone's San Francisco is wider than Android's Roboto — so on
// an iPhone "Start hosting" wrapped beside the logo, the hero heading took an
// extra line and the filter chips ran further off the edge than on Android
// at the same width. Variable (100–900), not Next's built-in Google Roboto,
// whose list here stops at fixed weights with no 600: font-semibold is used
// ~1,200 times and would have jumped to bold. Self-hosted from the
// @fontsource-variable package, so no request leaves for Google.
const roboto = localFont({
  src: [
    { path: '../node_modules/@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2', weight: '100 900', style: 'normal' },
    { path: '../node_modules/@fontsource-variable/roboto/files/roboto-latin-ext-wght-normal.woff2', weight: '100 900', style: 'normal' },
    { path: '../node_modules/@fontsource-variable/roboto/files/roboto-latin-wght-italic.woff2', weight: '100 900', style: 'italic' },
  ],
  variable: '--font-roboto',
  display: 'swap',
});

const SITE_URL = 'https://gallowaygetaways.co.uk';

const baseMetadata: Metadata = {
  // Every page title gets " | Galloway Getaways" appended automatically,
  // so individual pages only need to say what they are.
  title: {
    default: 'Holiday Cottages & Accommodation in Dumfries & Galloway',
    template: '%s | Galloway Getaways',
  },
  description:
    'Book holiday cottages and accommodation across Dumfries & Galloway. Book direct with the people who own them — no booking fee, ever.',

  // Added to an iPhone's Home Screen, it opens as an app with no Safari bars.
  // The manifest (app/manifest.ts) says the same to everything else. The
  // status bar stays the ordinary light one, so nothing slides under it.
  appleWebApp: {
    capable: true,
    title: 'Galloway Getaways',
    statusBarStyle: 'default',
  },
  // Tells search engines which address is the real one, so the www and
  // vercel.app versions don't compete with this one.
  metadataBase: new URL(SITE_URL),

  // NO `alternates` HERE, DELIBERATELY.
  //
  // This used to be `alternates: { canonical: '/' }`, and metadata is
  // inherited — so every page that did not set its own canonical told Google
  // it WAS the home page. Most pages set one, so the visible victim was the
  // 404: a dead listing URL answered with `noindex`, then a second robots tag
  // saying `index, follow` from here, then a canonical pointing at the home
  // page. noindex wins, so it was doing little harm, and "little harm" is not
  // a reason to leave a page lying about which page it is.
  //
  // The home page's canonical now lives on the home page, in app/page.tsx,
  // where nothing can inherit it.

  openGraph: {
    type: 'website',
    locale: 'en_GB',
    url: SITE_URL,
    siteName: 'Galloway Getaways',
    title: 'Holiday Cottages & Accommodation in Dumfries & Galloway',
    description:
      'Handpicked holiday cottages and accommodation across Dumfries & Galloway. Book direct with local hosts.',
    images: [
      {
        url: '/images/og-default.jpg',
        width: 1200,
        height: 630,
        alt: 'Holiday cottages in Dumfries & Galloway',
      },
    ],
  },

  twitter: {
    card: 'summary_large_image',
    title: 'Holiday Cottages & Accommodation in Dumfries & Galloway',
    description:
      'Handpicked holiday cottages and accommodation across Dumfries & Galloway.',
    images: ['/images/og-default.jpg'],
  },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

// Static metadata, so the layout — and every page under it — can be edge-cached.
// The viewport ships plain (width=device-width, initial-scale=1), the one Android
// needs so it keeps pinch-zoom; <ViewportLock> upgrades iOS to maximum-scale=1 +
// user-scalable=no on mount, which is what stops iOS Safari zooming on text-field
// focus (Liam's call, 03/10/2026 — see lib/viewport.ts). The viewport was chosen
// per request from the User-Agent, which read headers() and forced every page to
// render per-request; moving the iOS tweak to the client is what lets the layout
// cache. theme-color is white, matching the white header, so a phone browser's
// chrome blends into the page (the manifest, app/manifest.ts, says the same).
export const metadata: Metadata = {
  ...baseMetadata,
  themeColor: '#ffffff',
  viewport: { width: 'device-width', initialScale: 1 },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The accounts this business also appears as. One place defines them
  // (config/social.ts); the footer renders the same list.
  const sameAs = socialUrls();

  // Tells Google this is a real local business in Dumfries & Galloway,
  // which is what regional searches are matched against.
  const organisationSchema = {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    // The legal identity, matching Companies House — the trading name rides
    // along as alternateName so a search for "Galloway Getaways" still ties up.
    name: COMPANY.name,
    legalName: COMPANY.name,
    alternateName: 'Galloway Getaways',
    identifier: {
      '@type': 'PropertyValue',
      propertyID: 'Companies House company number',
      value: COMPANY.number,
    },
    description:
      'Self catering holiday cottages and apartments across Dumfries & Galloway, Scotland.',
    url: SITE_URL,
    logo: `${SITE_URL}/icon.svg`,
    image: `${SITE_URL}/images/og-default.jpg`,
    // The registered office.
    address: {
      '@type': 'PostalAddress',
      streetAddress: COMPANY.registeredOffice[0],
      addressLocality: COMPANY.registeredOffice[1],
      postalCode: COMPANY.registeredOffice[2],
      addressRegion: 'Dumfries & Galloway',
      addressCountry: 'GB',
    },
    areaServed: {
      '@type': 'AdministrativeArea',
      name: 'Dumfries & Galloway, Scotland',
    },
    // Ties the Facebook and Instagram accounts to this business, so Google
    // reads them as one entity rather than three things sharing a name.
    // Left off entirely when there are none: an empty array is a claim
    // ("this business has no other profiles"), not the absence of one.
    ...(sameAs.length ? { sameAs } : {}),
    priceRange: '££',
  };

  return (
    <html lang="en-GB" className={roboto.variable}>
      {/* The iPhone Home Screen icon, drawn from the goose (app/icons/[file]).
          A link here rather than metadata `icons`, which the file-based
          favicon (app/icon.svg) would override. */}
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body className="bg-white text-slate-900 antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organisationSchema) }}
        />
        <ViewportLock />
        <ChromeGate><Navbar /></ChromeGate>
        {children}
        {/* Add to Home Screen: signed-in phones only, once, AFTER the page's
            own content — never over something they need to act on. */}
        <InstallHint />
        <FooterSwitch full={<Footer />} minimal={<FooterMinimal />} />
        <ToastContainer position="top-center" />
        {/* Reads ?error= and ?success= off the URL and shows it. It was only
            on the dashboard, so every message the auth callback and the
            middleware redirect with landed on the home page and vanished.
            Suspense because it reads the query string. */}
        <Suspense fallback={null}>
          <Toast />
        </Suspense>
        {/* The one Log in or sign up panel. Every "Log in" button on the site
            opens this (components/auth/LoginModel → openAuthPanel). */}
        <AuthPanelHost />
        {/* Finish signing up: first and last name, unskippable, for a new
            account that got past the panel without one (Google, a closed tab). */}
        <FinishSignUpGate />
        {/* Keeps a sign-in alive for a year (or until the browser closes, if
            that was the choice) — lib/staySignedIn. */}
        <KeepSignedIn />
        {/* The installable app: service worker, the one-time Add to Home
            Screen hint on phones, and keeping push tied to this account. */}
        <PwaSetup />
        {/* Vercel Web Analytics — privacy-friendly visitor and page-view trends.
            It only reports once deployed on Vercel with Analytics switched on for
            the project; locally it no-ops. */}
        <Analytics />
      </body>
    </html>
  );
}
