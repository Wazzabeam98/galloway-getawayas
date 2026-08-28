'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { X, Phone } from 'lucide-react';
import { faultOptions, URGENCY_LEVELS, offersEmergency } from '@/lib/serviceEnquiries';

// Asking one tradesman to look at something.
//
// TWO ROUTES OUT OF ONE FORM
//
// Everything except an emergency writes an enquiry, emails him, and waits.
//
// An emergency does not wait. A burst pipe at nine at night is not solved by a
// web form and a countdown, so the host is given the number, and the row is
// written afterwards as the record of it. The screen changes shape when they
// pick it — there is no "send" for an emergency, there is a phone number.
//
// A provider who has not ticked that he turns out is never offered that route.
// The tick is the consent, and it is his, not ours to assume.

interface Props {
    provider: any;
    trade: string;
    listings: any[];
    session: any;
    offered: string[];
    onClose: () => void;
}

export default function EnquiryForm({ provider, trade, listings, session, offered, onClose }: Props) {
    const [urgency, setUrgency] = useState('soon');
    const [listingId, setListingId] = useState(listings[0]?.id || '');
    const [faults, setFaults] = useState<string[]>([]);
    const [summary, setSummary] = useState('');
    const [whenNote, setWhenNote] = useState('');
    const [accessNote, setAccessNote] = useState('');
    const [name, setName] = useState(session?.user?.user_metadata?.full_name || '');
    const [phone, setPhone] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState<any>(null);

    const emergency = urgency === 'emergency';

    // The page deliberately does not fetch `contact_phone`, so the browser
    // cannot know whether he has one — it asks only whether he ticked that he
    // turns out. The route checks the number as well and refuses without one.
    // Optimistic here, authoritative there, which is the right way round: the
    // rare provider who turns out and left his number blank sees an error
    // instead of a wrongly hidden option.
    const canDoEmergency = offersEmergency({ contact_phone: 'unknown' }, offered);
    const options = faultOptions(trade);

    const toggle = (key: string) => {
        setFaults((current) =>
            current.indexOf(key) === -1
                ? current.concat([key])
                : current.filter((k) => k !== key)
        );
    };

    const send = async () => {
        setSending(true);

        const res = await fetch('/api/services/enquiries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider_id: provider.id,
                listing_id: listingId || null,
                urgency,
                summary,
                fault_keys: faults,
                when_note: whenNote,
                access_note: accessNote,
                host_name: name,
                host_phone: phone,
                host_email: session?.user?.email || '',
            }),
        });

        const json = await res.json();
        setSending(false);

        if (!json.ok) {
            const first = json.problems && json.problems[0];
            toast.error(first ? first.message : (json.error || 'Could not send that.'), { theme: 'colored' });
            return;
        }

        setSent(json);
    };

    if (!session?.user) {
        return (
            <Shell onClose={onClose} title={'Ask ' + provider.business_name}>
                <p className="text-slate-600">
                    Sign in to ask for help. We need to know who you are before we pass anything on.
                </p>
                <Link
                    href="/account"
                    className="mt-5 inline-block rounded-xl bg-emerald-700 px-4 py-2.5 text-white text-sm font-semibold"
                >
                    Sign in
                </Link>
            </Shell>
        );
    }

    // ---- it has gone ------------------------------------------------------
    if (sent) {
        return (
            <Shell onClose={onClose} title={sent.phone ? 'Ring them now' : 'Sent'}>
                {sent.phone ? (
                    <>
                        <p className="text-slate-600">
                            {provider.business_name} turns out to emergencies. We have emailed them so
                            they know what it is about before the phone goes.
                        </p>
                        <a
                            href={'tel:' + String(sent.phone).replace(/\s/g, '')}
                            className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-4 text-white text-lg font-bold"
                        >
                            <Phone className="w-5 h-5" strokeWidth={2} />
                            {sent.phone}
                        </a>
                        <p className="text-sm text-slate-500 mt-4">
                            Reference {sent.reference}. Nothing else happens automatically — the job and
                            the price are between the two of you.
                        </p>
                    </>
                ) : (
                    <>
                        <p className="text-slate-600">
                            Your enquiry has gone to {provider.business_name}, and to nobody else. We will
                            email you the moment they answer, and tell you if they do not so you can try
                            somebody else.
                        </p>
                        <p className="text-sm text-slate-500 mt-4">Reference {sent.reference}.</p>
                        <Link
                            href="/dashboard/enquiries"
                            className="mt-5 inline-block rounded-xl bg-emerald-700 px-4 py-2.5 text-white text-sm font-semibold"
                        >
                            See your enquiries
                        </Link>
                    </>
                )}
            </Shell>
        );
    }

    return (
        <Shell onClose={onClose} title={'Ask ' + provider.business_name}>
            <div className="space-y-5">
                <fieldset>
                    <legend className="text-sm font-semibold text-slate-700">How urgent is it?</legend>
                    <div className="mt-2 space-y-2">
                        {URGENCY_LEVELS.map((level) => (
                            <label
                                key={level.key}
                                className="flex gap-3 rounded-xl border border-slate-300 p-3 cursor-pointer hover:border-emerald-700"
                            >
                                <input
                                    type="radio"
                                    name="urgency"
                                    checked={urgency === level.key}
                                    onChange={() => setUrgency(level.key)}
                                    className="mt-1"
                                />
                                <span>
                                    <span className="block text-sm font-semibold text-slate-900">{level.label}</span>
                                    <span className="block text-xs text-slate-500 mt-0.5">{level.hint}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                </fieldset>

                {emergency && !canDoEmergency && (
                    <p className="rounded-xl bg-amber-50 text-amber-900 text-sm p-3">
                        {provider.business_name} has not said they turn out to emergencies, so we cannot
                        hand you their number. Pick somebody who does, or send this as an ordinary
                        enquiry.
                    </p>
                )}

                {emergency && canDoEmergency && (
                    <p className="rounded-xl bg-emerald-50 text-emerald-900 text-sm p-3">
                        You will get their number on the next screen and ring it yourself. Tell us what is
                        happening first — we email it to them so they are not starting cold.
                    </p>
                )}

                {listings.length > 0 && (
                    <label className="block">
                        <span className="text-sm font-semibold text-slate-700">Which property?</span>
                        <select
                            value={listingId}
                            onChange={(e) => setListingId(e.target.value)}
                            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                        >
                            <option value="">Not one of mine</option>
                            {listings.map((l) => (
                                <option key={l.id} value={l.id}>{l.title}</option>
                            ))}
                        </select>
                    </label>
                )}

                {options.length > 0 && (
                    <fieldset>
                        {/* The same list he ticked when he signed up, so
                            "something keeps tripping" means one thing to both
                            of them and the email needs no translating. */}
                        <legend className="text-sm font-semibold text-slate-700">
                            Anything that fits? (optional)
                        </legend>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {options.map((option) => (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => toggle(option.key)}
                                    className={
                                        'rounded-full border px-3 py-1.5 text-sm '
                                        + (faults.indexOf(option.key) !== -1
                                            ? 'border-emerald-700 bg-emerald-50 text-emerald-900 font-semibold'
                                            : 'border-slate-300 text-slate-700')
                                    }
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </fieldset>
                )}

                <label className="block">
                    <span className="text-sm font-semibold text-slate-700">What is wrong?</span>
                    <textarea
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        rows={4}
                        placeholder="No hot water since Sunday. Combi boiler, about eight years old, pressure looks fine."
                        className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                    />
                </label>

                {!emergency && (
                    <label className="block">
                        <span className="text-sm font-semibold text-slate-700">When suits? (optional)</span>
                        <input
                            value={whenNote}
                            onChange={(e) => setWhenNote(e.target.value)}
                            placeholder="Any weekday before the 14th — it is empty until then"
                            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                        />
                    </label>
                )}

                <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Getting in (optional)</span>
                    <input
                        value={accessNote}
                        onChange={(e) => setAccessNote(e.target.value)}
                        placeholder="Key safe by the back door, I can meet him there"
                        className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                    />
                </label>

                <div className="grid sm:grid-cols-2 gap-3">
                    <label className="block">
                        <span className="text-sm font-semibold text-slate-700">Your name</span>
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                        />
                    </label>
                    <label className="block">
                        <span className="text-sm font-semibold text-slate-700">Phone</span>
                        <input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                        />
                    </label>
                </div>

                <p className="text-xs text-slate-500">
                    {emergency
                        ? 'Your name, number and the property address go to them with this.'
                        : 'They see your name and number now. The address goes across only if they say yes.'}
                </p>

                <button
                    onClick={send}
                    disabled={sending || (emergency && !canDoEmergency)}
                    className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-white font-semibold disabled:opacity-50"
                >
                    {sending ? 'Sending…' : emergency ? 'Get their number' : 'Send to ' + provider.business_name}
                </button>
            </div>
        </Shell>
    );
}

function Shell({ children, onClose, title }: { children: any; onClose: () => void; title: string }) {
    return (
        <div className="fixed inset-0 z-50 bg-slate-900/40 overflow-y-auto p-4 sm:p-8">
            <div className="mx-auto max-w-lg rounded-2xl bg-white p-6 shadow-xl">
                <div className="flex items-start justify-between gap-4 mb-5">
                    <h2 className="text-xl font-bold text-slate-900">{title}</h2>
                    <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
