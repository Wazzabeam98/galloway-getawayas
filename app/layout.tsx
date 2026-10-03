export const dynamic = 'force-dynamic';

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
import AgreementGate from '@/components/legal/AgreementGate';
import AuthPanelHost from '@/components/auth/AuthPanel';
import KeepSignedIn from '@/components/auth/KeepSignedIn';
import { Analytics } from '@vercel/analytics/next';
import { socialUrls } from '@/config/social';
import { COMPANY } from '@/config/company';
import type { Metadata } from 'next';
const SITE_URL = 'https://gallowaygetaways.co.uk';

export const metadata: Metadata = {
  // Every page title gets " | Galloway Getaways" appended automatically,
  // so individual pages only need to say what they are.
  title: {
    default: 'Holiday Cottages & Accommodation in Dumfries & Galloway',
    template: '%s | Galloway Getaways',
  },
  description:
    'Book holiday cottages and accommodation across Dumfries & Galloway. Booked direct with the people who own them — no booking fee, ever.',

  // Tells search engines which address is the real one, so the www and
  // vercel.app versions don't compete with this one.
  metadataBase: new URL(SITE_URL),

  // maximum-scale=1 + user-scalable=no: Liam's call, 03/10/2026. iOS Safari
  // zoomed the whole page the instant the sign-in field was tapped and kept
  // that zoom for the visit; four fixes (16px then 17px fields, no forced
  // focus, overflow guard) did not stop it on his iPhone 15. This stops
  // Safari zooming on focus at all.
  //
  // What it costs, plainly: on Android (Chrome, Samsung Internet) nobody can
  // pinch-zoom anywhere on the site unless they have turned on their
  // browser's "force enable zoom" accessibility setting — people with low
  // vision lose the easiest way to read small text and photos. On iPhone
  // Safari has ignored both settings for pinching since iOS 10, so iPhone
  // users can still pinch; only the automatic zoom-on-focus stops.
  // Accessibility checkers (Lighthouse, WCAG 1.4.4) flag it. The narrower
  // option — send these two only to iPhones, leave Android untouched — is
  // in the PR and is his to decide.
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },

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
        url: '/images/hero-1.jpg',
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
    images: ['/images/hero-1.jpg'],
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
    image: `${SITE_URL}/images/hero-1.jpg`,
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
    <html lang="en-GB">
      <body className="bg-white text-slate-900 antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organisationSchema) }}
        />
        <ChromeGate><Navbar /></ChromeGate>
        {children}
        <FooterSwitch full={<Footer />} minimal={<FooterMinimal />} />
        <ToastContainer position="top-center" />
        {/* Reads ?error= and ?success= off the URL and shows it. It was only
            on the dashboard, so every message the auth callback and the
            middleware redirect with landed on the home page and vanished.
            Suspense because it reads the query string. */}
        <Suspense fallback={null}>
          <Toast />
        </Suspense>
        {/* The sign-in prompt for a missing or out-of-date agreement — one
            document at a time (lib/agreements.ts). */}
        <AgreementGate />
        {/* The one Log in or sign up panel. Every "Log in" button on the site
            opens this (components/auth/LoginModel → openAuthPanel). */}
        <AuthPanelHost />
        {/* Keeps a sign-in alive for a year (or until the browser closes, if
            that was the choice) — lib/staySignedIn. */}
        <KeepSignedIn />
        {/* Vercel Web Analytics — privacy-friendly visitor and page-view trends.
            It only reports once deployed on Vercel with Analytics switched on for
            the project; locally it no-ops. */}
        <Analytics />
      </body>
    </html>
  );
}
