'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { X } from 'lucide-react';
import {
    faultOptions,
    URGENCY_LEVELS,
    TIME_WINDOWS,
    offersEmergency,
    needsDate,
    clockTime,
    EMERGENCY_MINUTES,
} from '@/lib/serviceEnquiries';

// Asking one tradesman to look at something.
//
// ONE ROUTE, AND AN EMERGENCY IS A SHORTER WAIT RATHER THAN A DIFFERENT THING
//
// This form used to hand over the phone number on the spot for an emergency.
// It does not any more, and the reason is what the platform can prove: an
// introduction nobody accepted is not evidence the platform found anybody
// work, and that evidence is the whole argument for the subscription. So an
// emergency is sent like everything else, with a twenty-minute deadline, and
// the number is released automatically if nobody answers by then.
//
// What the host is promised, on the screen and in the email, is that they will
// not be left waiting past that. Say it plainly here: a host with water coming
// through a ceiling needs to know how long they are watching for.
//
// A provider who has not ticked that he turns out is never offered the
// emergency at all. The tick is the consent, and it is his, not ours to
// assume.
//
// NOTHING HERE ASKS FOR ANYTHING WE ALREADY HOLD
//
// The name and the phone come off the profile, and the property comes from the
// page behind. They stay editable — the number to ring about a cottage is not
// always the one on the account — but they arrive filled in.

interface Props {
    provider: any;
    trade: string;
    listings: any[];
    listingId?: string;
    session: any;
    offered: string[];
    onClose: () => void;
}

export default function EnquiryForm({
    provider, trade, listings, listingId: forProperty, session, offered, onClose,
}: Props) {
    const supabase = createClientComponentClient();

    const [urgency, setUrgency] = useState('soon');
    const [listingId, setListingId] = useState(forProperty || listings[0]?.id || '');
    const [faults, setFaults] = useState<string[]>([]);
    const [summary, setSummary] = useState('');
    const [whenNote, setWhenNote] = useState('');
    const [accessNote, setAccessNote] = useState('');
    const [preferredDate, setPreferredDate] = useState('');
    const [windowKey, setWindowKey] = useState('any');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState<any>(null);

    // Off the profile, not out of the host's head. `full_name` and `phone` are
    // already there; asking for them again is asking somebody to type an
    // answer we are holding.
    //
    // Editable afterwards on purpose: the number to ring about a cottage is
    // not always the number on the account, and a caretaker's mobile is a
    // perfectly ordinary answer.
    useEffect(() => {
        if (!session?.user) return;

        const load = async () => {
            const { data } = await supabase
                .from('profiles')
                .select('full_name, preferred_name, phone')
                .eq('id', session.user.id)
                .maybeSingle();

            if (!data) return;
            setName((current) => current || String(data.full_name || data.preferred_name || ''));
            setPhone((current) => current || String(data.phone || ''));
        };

        load();
    }, [session, supabase]);

    const emergency = urgency === 'emergency';
    const planned = needsDate(urgency);
    const chosenWindow = TIME_WINDOWS.filter((w) => w.key === windowKey)[0] || TIME_WINDOWS[0];

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
                preferred_date: planned ? preferredDate : null,
                window_from: planned ? chosenWindow.from : null,
                window_to: planned ? chosenWindow.to : null,
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
            <Shell onClose={onClose} title="Sent">
                {sent.emergency ? (
                    <>
                        <p className="text-slate-600">
                            Your emergency has gone to {provider.business_name}, and to nobody else.
                            They have {EMERGENCY_MINUTES} minutes to answer.
                        </p>
                        {/* The promise, in the plainest words available. A host
                            watching water come through a ceiling is entitled to
                            know exactly how long they are watching for. */}
                        <p className="mt-4 rounded-xl bg-emerald-50 text-emerald-900 p-4 font-semibold">
                            If they have not answered by {clockTime(sent.expires_at)} we will send you
                            their number so you can ring them yourself. You will not be left waiting
                            past that.
                        </p>
                    </>
                ) : (
                    <p className="text-slate-600">
                        Your enquiry has gone to {provider.business_name}, and to nobody else. We will
                        email you the moment they answer, and tell you if they do not so you can try
                        somebody else.
                    </p>
                )}

                <p className="text-sm text-slate-500 mt-4">Reference {sent.reference}.</p>
                <Link
                    href="/dashboard/enquiries"
                    className="mt-5 inline-block rounded-xl bg-emerald-700 px-4 py-2.5 text-white text-sm font-semibold"
                >
                    See your enquiries
                </Link>
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
                        {provider.business_name} has not said they turn out to emergencies. Pick somebody
                        who does, or send this as an ordinary enquiry.
                    </p>
                )}

                {emergency && canDoEmergency && (
                    <p className="rounded-xl bg-emerald-50 text-emerald-900 text-sm p-3">
                        We ask them first and give them {EMERGENCY_MINUTES} minutes. If they have not
                        answered by then we send you their number to ring. You are not left waiting
                        either way.
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

                {planned && (
                    <div className="rounded-xl border border-slate-300 p-4 space-y-3">
                        {/* A REQUEST, AND IT HAS TO READ AS ONE.
                            Nothing here knows whether he is free that day,
                            nothing holds the window, and nothing stops four
                            hosts asking for the same one. Hence a date input
                            and a list of windows rather than a calendar: a
                            calendar with days on it is a promise about
                            availability, and there is nothing behind it. */}
                        <p className="text-sm font-semibold text-slate-700">
                            When would you like them?
                        </p>
                        <p className="text-xs text-slate-500 -mt-2">
                            This is what you are asking for. They will confirm what actually suits when
                            they get back to you — nothing here books a slot.
                        </p>

                        <label className="block">
                            <span className="text-sm text-slate-700">Day</span>
                            <input
                                type="date"
                                value={preferredDate}
                                onChange={(e) => setPreferredDate(e.target.value)}
                                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                            />
                        </label>

                        <label className="block">
                            <span className="text-sm text-slate-700">Time</span>
                            <select
                                value={windowKey}
                                onChange={(e) => setWindowKey(e.target.value)}
                                className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                            >
                                {TIME_WINDOWS.map((w) => (
                                    <option key={w.key} value={w.key}>{w.label}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                )}

                {!emergency && (
                    <label className="block">
                        <span className="text-sm font-semibold text-slate-700">
                            Anything else about timing? (optional)
                        </span>
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
                    They see your name and number now. The address goes across only if they say yes
                    {emergency ? ', or when we release their number to you' : ''}.
                </p>

                <button
                    onClick={send}
                    disabled={sending || (emergency && !canDoEmergency)}
                    className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-white font-semibold disabled:opacity-50"
                >
                    {sending
                        ? 'Sending…'
                        : emergency
                            ? 'Send now — ' + EMERGENCY_MINUTES + ' minutes'
                            : 'Send to ' + provider.business_name}
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
