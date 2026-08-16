import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, MapPin, Clock } from 'lucide-react';

export const metadata: Metadata = {
    title: 'Contact Us',
    description: 'Get in touch with Galloway Getaways about a booking, a listing or anything else.',
    alternates: { canonical: '/contact' },
};

const CONTACTS = [
    {
        title: 'Guest support',
        email: 'support@gallowaygetaways.co.uk',
        note: 'Problems with a booking, a stay, or a refund.',
    },
    {
        title: 'Bookings',
        email: 'bookings@gallowaygetaways.co.uk',
        note: 'Questions about a reservation or a confirmation you were expecting.',
    },
    {
        title: 'Hosting',
        email: 'hosts@gallowaygetaways.co.uk',
        note: 'Listing a property, payouts, or anything host-related.',
    },
    {
        title: 'Property services',
        email: 'services@gallowaygetaways.co.uk',
        note: 'Hot tub servicing, changeover cleans and maintenance.',
    },
    {
        title: 'General enquiries',
        email: 'hello@gallowaygetaways.co.uk',
        note: 'Anything else, including partnerships and press.',
    },
];

export default function ContactPage() {
    return (
        <div className="max-w-3xl mx-auto px-6 py-12">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Contact us</h1>
            <p className="text-slate-600 mb-10">
                We are a small team based in Dumfries &amp; Galloway. A real person reads every message.
            </p>

            <div className="border rounded-2xl divide-y mb-10">
                {CONTACTS.map((c) => (
                    <div key={c.email} className="p-5">
                        <div className="flex items-start gap-3">
                            <Mail className="w-5 h-5 text-emerald-700 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
                            <div>
                                <div className="font-semibold text-slate-900 text-sm">{c.title}</div>
                                <a
                                    href={`mailto:${c.email}`}
                                    className="text-sm text-emerald-700 underline break-all"
                                >
                                    {c.email}
                                </a>
                                <p className="text-xs text-slate-500 mt-1">{c.note}</p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
                <div className="border rounded-2xl p-5">
                    <Clock className="w-5 h-5 text-emerald-700 mb-2" strokeWidth={1.5} />
                    <div className="font-semibold text-slate-900 text-sm mb-1">When we reply</div>
                    <p className="text-sm text-slate-600">
                        Usually within one working day. If you are mid-stay and something is wrong, message
                        your host through the site first — they can often sort it faster than we can.
                    </p>
                </div>

                <div className="border rounded-2xl p-5">
                    <MapPin className="w-5 h-5 text-emerald-700 mb-2" strokeWidth={1.5} />
                    <div className="font-semibold text-slate-900 text-sm mb-1">Where we are</div>
                    <p className="text-sm text-slate-600">
                        Galloway Getaways Ltd, registered in Scotland.
                        <br />
                        Company number to be confirmed.
                    </p>
                </div>
            </div>

            <p className="text-sm text-slate-500">
                See also our{' '}
                <Link href="/terms" className="text-emerald-700 underline">Terms &amp; Conditions</Link>,{' '}
                <Link href="/privacy" className="text-emerald-700 underline">Privacy Policy</Link> and{' '}
                <Link href="/cancellation-policy" className="text-emerald-700 underline">
                    Cancellation &amp; Refund Policy
                </Link>
                .
            </p>
        </div>
    );
}
