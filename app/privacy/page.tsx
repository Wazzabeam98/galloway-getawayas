import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
    title: 'Privacy Policy',
    description: 'What data Galloway Getaways collects, why, and what your rights are.',
    alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
    return (
        <div className="max-w-3xl mx-auto px-6 py-12">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
            <p className="text-sm text-slate-500 mb-10">Last updated 16 August 2026</p>

            <div className="text-slate-700 space-y-4">
                <h2 className="text-xl font-bold text-slate-900 pt-4">Who we are</h2>
                <p>
                    Galloway Getaways Ltd is the data controller for the information described here. We are
                    registered in Scotland (company number SC899385). For anything about your data,
                    email{' '}
                    <a href="mailto:hello@gallowaygetaways.co.uk" className="text-emerald-700 underline">
                        hello@gallowaygetaways.co.uk
                    </a>
                    .
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">What we collect</h2>
                <ul className="list-disc pl-5 space-y-2">
                    <li>
                        <strong>Account details</strong> — your name, email address, and a password we never
                        see in readable form.
                    </li>
                    <li>
                        <strong>Profile information</strong> — preferred name, phone number, address and
                        profile photo, where you choose to give them.
                    </li>
                    <li>
                        <strong>Booking information</strong> — the properties you book, dates, guest numbers
                        and the messages you exchange with hosts.
                    </li>
                    <li>
                        <strong>Payment information</strong> — handled entirely by Stripe. We receive
                        confirmation that a payment succeeded and the last four digits of the card. We never
                        see or store your full card number.
                    </li>
                    <li>
                        <strong>Listing information</strong>, if you are a host — including your property
                        address and short-term let licence number, which the law requires us to display.
                    </li>
                </ul>

                <h2 className="text-xl font-bold text-slate-900 pt-4">Why we use it</h2>
                <p>
                    To run your bookings and take payment, which is necessary to perform our contract with
                    you. To send you booking confirmations, check-in details and messages from your host. To
                    meet legal obligations including tax records and short-term let licensing. And to keep
                    the platform secure and prevent fraud, which is our legitimate interest.
                </p>
                <p>
                    We do not sell your data, and we do not use it for advertising.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">Who we share it with</h2>
                <ul className="list-disc pl-5 space-y-2">
                    <li>
                        <strong>Your host</strong> — your name and booking details, so they can prepare for
                        your stay. Your exact address is not shared with them.
                    </li>
                    <li><strong>Stripe</strong>, to process payments and payouts.</li>
                    <li><strong>Supabase</strong>, which hosts our database, and <strong>Vercel</strong>, which hosts the site.</li>
                    <li>
                        <strong>Authorities</strong>, where we are legally required to — including licensing
                        authorities in relation to short-term lets.
                    </li>
                </ul>

                <h2 className="text-xl font-bold text-slate-900 pt-4">How long we keep it</h2>
                <p>
                    Booking and payment records are kept for six years, as UK tax law requires. Account
                    information is kept while your account is open. If you delete your account, we remove
                    your profile and personal details, though we must retain booking records for that
                    six-year period.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">Your rights</h2>
                <p>
                    Under UK GDPR you can ask for a copy of your data, ask us to correct it, ask us to
                    delete it, object to how we use it, or ask us to restrict processing. You can download
                    everything we hold about you at any time from{' '}
                    <Link href="/account" className="text-emerald-700 underline">
                        Account settings
                    </Link>{' '}
                    under Privacy, and delete your account from the same place.
                </p>
                <p>
                    If you think we have handled your data badly, you can complain to the Information
                    Commissioner&apos;s Office at ico.org.uk. We would rather you told us first so we can
                    put it right.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">Cookies</h2>
                <p>
                    We use only the cookies needed to keep you signed in and to remember whether you are
                    browsing as a guest or a host. We do not use advertising or tracking cookies.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">Where your data is held</h2>
                <p>
                    Our database and files are held within the UK and EU. Some of our suppliers, including
                    Stripe, may process data outside the UK under safeguards approved for international
                    transfers.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">Changes</h2>
                <p>
                    If we change this policy we will update the date at the top, and tell you directly if
                    the change is significant.
                </p>
            </div>
        </div>
    );
}
