import React from 'react';
import Link from 'next/link';
import { GooseMark } from '@/components/base/Logo';

const Footer = () => {
    const year = new Date().getFullYear();

    return (
        <footer className="border-t mt-20 bg-stone-50">
            <div className="max-w-7xl mx-auto px-6 md:px-10 py-12">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
                    <div className="col-span-2 md:col-span-1">
                        <div className="flex items-center gap-2 mb-3">
                            <GooseMark className="w-8 h-auto text-emerald-700" />
                            <div className="flex flex-col">
                                <span className="text-sm font-extrabold tracking-tight text-stone-900 leading-none">
                                    Galloway
                                </span>
                                <span className="text-[9px] font-semibold tracking-[0.2em] text-emerald-700 uppercase mt-0.5">
                                    Getaways
                                </span>
                            </div>
                        </div>
                        <p className="text-xs text-slate-500">
                            Self catering holiday cottages and apartments across Dumfries &amp; Galloway.
                            Book direct with local hosts.
                        </p>
                    </div>

                    <div>
                        <h3 className="text-sm font-semibold text-slate-900 mb-3">Guests</h3>
                        <ul className="space-y-2 text-sm text-slate-600">
                            <li><Link href="/" className="hover:text-slate-900">Find a place to stay</Link></li>
                            <li><Link href="/trips" className="hover:text-slate-900">Your trips</Link></li>
                            <li>
                                <Link href="/cancellation-policy" className="hover:text-slate-900">
                                    Cancellation policy
                                </Link>
                            </li>
                        </ul>
                    </div>

                    <div>
                        <h3 className="text-sm font-semibold text-slate-900 mb-3">Hosting</h3>
                        <ul className="space-y-2 text-sm text-slate-600">
                            <li><Link href="/business" className="hover:text-slate-900">Start hosting</Link></li>
                            <li><Link href="/dashboard" className="hover:text-slate-900">Host dashboard</Link></li>
                            <li><Link href="/services/property" className="hover:text-slate-900">Property services</Link></li>
                        </ul>
                    </div>

                    <div>
                        <h3 className="text-sm font-semibold text-slate-900 mb-3">Company</h3>
                        <ul className="space-y-2 text-sm text-slate-600">
                            <li><Link href="/contact" className="hover:text-slate-900">Contact us</Link></li>
                            <li><Link href="/terms" className="hover:text-slate-900">Terms &amp; conditions</Link></li>
                            <li><Link href="/privacy" className="hover:text-slate-900">Privacy policy</Link></li>
                        </ul>
                    </div>
                </div>

                <div className="border-t pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">
                        &copy; {year} Galloway Getaways Ltd. Registered in Scotland.
                    </p>
                    <a
                        href="mailto:hello@gallowaygetaways.co.uk"
                        className="text-xs text-slate-500 hover:text-slate-900"
                    >
                        hello@gallowaygetaways.co.uk
                    </a>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
