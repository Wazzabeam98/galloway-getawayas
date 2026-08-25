import React from 'react';

// The legal line and a way to reach us. Nothing to browse.
const FooterMinimal = () => {
    const year = new Date().getFullYear();

    return (
        <footer className="border-t mt-12 bg-stone-50">
            <div className="max-w-7xl mx-auto px-6 md:px-10 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
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
        </footer>
    );
};

export default FooterMinimal;
