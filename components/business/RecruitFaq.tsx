import { ChevronDown } from 'lucide-react';
import { RECRUIT_FAQ, type FaqAudience } from '@/lib/recruitFaq';
import { COMPANY } from '@/config/company';

// "Your questions, answered" — the questions a host, an experience provider or a
// trade asks before signing up, under the first screen of their sign-up flow.
//
// Copied from Airbnb's hosting pages (airbnb.co.uk/host/homes, /host/experiences,
// looked at 4 Oct 2026): a centred "Your questions, answered" heading, then
// questions that open in place to their answer, one at a time, on hairline
// dividers. What we leave out: their picture cards, the topic tabs and the
// "Ask a host" button — we have one short list per audience, and a person to
// email.
//
// Flat, never lifted (CLAUDE.md): it is content you read, not a surface you act on.
// Native <details>, so it opens with the keyboard and a screen reader for free and
// needs no client JavaScript. The wording lives in lib/recruitFaq.ts, where a test
// holds the numbers to the code.
export default function RecruitFaq({ audience, className = '' }: { audience: FaqAudience; className?: string }) {
    const items = RECRUIT_FAQ[audience];
    return (
        <section aria-labelledby={`faq-${audience}`} className={'mx-auto w-full max-w-3xl ' + className}>
            <h2 id={`faq-${audience}`} className="text-center text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
                Your questions, answered
            </h2>
            <div className="mt-6 divide-y divide-slate-200 border-y border-slate-200">
                {items.map((item) => (
                    <details key={item.q} className="group">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left font-semibold text-slate-900 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 rounded">
                            <span>{item.q}</span>
                            <ChevronDown className="h-5 w-5 flex-none text-slate-500 transition-transform group-open:rotate-180" aria-hidden />
                        </summary>
                        <div className="pb-5 pr-9 text-slate-600 [text-wrap:pretty] space-y-2">
                            {item.a.map((para, i) => <p key={i}>{para}</p>)}
                        </div>
                    </details>
                ))}
            </div>
            <p className="mt-5 text-center text-sm text-slate-500">
                Anything else? Email us at{' '}
                <a href={'mailto:' + COMPANY.email} className="font-semibold text-slate-700 underline underline-offset-2 hover:text-slate-900">
                    {COMPANY.email}
                </a>
                .
            </p>
        </section>
    );
}
