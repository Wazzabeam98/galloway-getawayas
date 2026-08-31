export const dynamic = 'force-dynamic';

import './globals.css';
import 'react-toastify/dist/ReactToastify.css';
import Navbar from '@/components/base/Navbar';
import Footer from '@/components/base/Footer';
import FooterMinimal from '@/components/base/FooterMinimal';
import FooterSwitch from '@/components/base/FooterSwitch';
import { ToastContainer } from 'react-toastify';
import { Suspense } from 'react';
import Toast from '@/components/base/Toast';
import type { Metadata } from 'next';

const SITE_URL = 'https://gallowaygetaways.co.uk';

export const metadata: Metadata = {
  // Every page title gets " | Galloway Getaways" appended automatically,
  // so individual pages only need to say what they are.
  title: {
    default: 'Self Catering Cottages in Dumfries & Galloway',
    template: '%s | Galloway Getaways',
  },
  description:
    'Book self catering holiday cottages and apartments across Dumfries & Galloway. Booked direct with the people who own them — no booking fee, ever.',

  // Tells search engines which address is the real one, so the www and
  // vercel.app versions don't compete with this one.
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: '/' },

  openGraph: {
    type: 'website',
    locale: 'en_GB',
    url: SITE_URL,
    siteName: 'Galloway Getaways',
    title: 'Self Catering Holiday Cottages in Dumfries & Galloway',
    description:
      'Handpicked self catering cottages and apartments across Dumfries & Galloway. Book direct with local hosts.',
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
    title: 'Self Catering Holiday Cottages in Dumfries & Galloway',
    description:
      'Handpicked self catering cottages and apartments across Dumfries & Galloway.',
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
  // Tells Google this is a real local business in Dumfries & Galloway,
  // which is what regional searches are matched against.
  const organisationSchema = {
    '@context': 'https://schema.org',
    '@type': 'LodgingBusiness',
    name: 'Galloway Getaways',
    description:
      'Self catering holiday cottages and apartments across Dumfries & Galloway, Scotland.',
    url: SITE_URL,
    logo: `${SITE_URL}/icon.svg`,
    image: `${SITE_URL}/images/hero-1.jpg`,
    address: {
      '@type': 'PostalAddress',
      addressRegion: 'Dumfries & Galloway',
      addressCountry: 'GB',
    },
    areaServed: {
      '@type': 'AdministrativeArea',
      name: 'Dumfries & Galloway, Scotland',
    },
    priceRange: '££',
  };

  return (
    <html lang="en-GB">
      <body className="bg-white text-slate-900 antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organisationSchema) }}
        />
        <Navbar />
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
      </body>
    </html>
  );
}
