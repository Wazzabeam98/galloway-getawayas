'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { X } from 'lucide-react';
import DatePicker from '@/components/services/DatePicker';
import {
    faultOptions,
    URGENCY_LEVELS,
    TIME_WINDOWS,
    offersEmergency,
    needsDate,
    enquiryProblems,
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
// TWO STEPS, BECAUSE ONE DID NOT FIT ON A SCREEN
//
// The problem on the first, the timing and the contact details on the second.
// That is the split a host would draw themselves: what is wrong is one train
// of thought and when-and-who is another.
//
// The step boundary is also where the validation lands. Step one is checked
// before it will advance — so a problem always appears on the step its field
// is on, rather than being reported from a screen the host cannot see. Sending
// runs the full check again regardless, because the route is the authority and
// a client-side gate is a convenience.
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
    const [step, setStep] = useState<1 | 2>(1);

    // The scrolling middle of the card. Reset to the top on every step change:
    // without it, a host who scrolled to the bottom of step one arrives at
    // step two already scrolled past its opening line — which is the sentence
    // saying the date is what they are ASKING for rather than a slot he has
    // agreed to. Losing that line is losing the thing that keeps this from
    // reading like a booking.
    const scroller = useRef<HTMLDivElement | null>(null);
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState<any>(null);

    // EVERY problem, not the first one.
    //
    // This showed problems[0] in a toast, and enquiryProblems happens to check
    // the phone before the name — so somebody who left both blank was asked
    // for a number, filled it in, pressed send again and was then asked for
    // their name. The validation was right and the reporting made it look
    // broken. Found on the second walk-through, reported as "it only asked for
    // the number", which is exactly what it did.
    const [problems, setProblems] = useState<Array<{ field: string; message: string }>>([]);

    // Off the profile, not out of the host's head. Asking for something we are
    // already holding is what makes a shop feel like a form.
    //
    // THREE PLACES, BECAUSE ONE OF THEM IS OFTEN EMPTY. `profiles.full_name`
    // is an empty string rather than null on accounts that never filled it in,
    // and `phone` is frequently null — but a name given at sign-up lives in
    // the auth user's metadata, which is a perfectly good answer and was being
    // ignored. Falsy-checked rather than null-checked for exactly that reason:
    // '' must fall through, not win.
    //
    // A blank result is not a fault. It means we hold nothing, the fields stay
    // empty, and the host types them — which is the honest outcome and the one
    // to expect on a fresh test account.
    //
    // Editable either way: the number to ring about a cottage is not always
    // the number on the account, and a caretaker's mobile is ordinary.
    useEffect(() => {
        if (!session?.user) return;

        const load = async () => {
            const { data } = await supabase
                .from('profile_private')
                .select('full_name, preferred_name, phone')
                .eq('id', session.user.id)
                .maybeSingle();

            const metadata = session.user.user_metadata || {};

            const knownName = String(
                (data && (data.full_name || data.preferred_name))
                || metadata.full_name
                || metadata.name
                || ''
            ).trim();

            const knownPhone = String((data && data.phone) || metadata.phone || '').trim();

            if (knownName) setName((current) => current || knownName);
            if (knownPhone) setPhone((current) => current || knownPhone);
        };

        load();
    }, [session, supabase]);

    useEffect(() => {
        if (scroller.current) scroller.current.scrollTop = 0;
    }, [step]);

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

    // The fields that live on step one. Checked here so that pressing Next
    // with an empty description says so under the description, instead of the
    // send button on the next screen reporting a field nobody can see.
    const STEP_ONE_FIELDS = ['trade', 'provider_id', 'urgency', 'summary'];

    const next = () => {
        const found = enquiryProblems(currentDraft()).filter(
            (p) => STEP_ONE_FIELDS.indexOf(p.field) !== -1
        );

        setProblems(found);
        if (found.length) return;

        setStep(2);
    };

    const currentDraft = () => ({
        trade,
        provider_id: provider.id,
        urgency,
        summary,
        fault_keys: faults,
        host_name: name,
        host_phone: phone,
        preferred_date: planned ? preferredDate : null,
        window_from: planned ? chosenWindow.from : null,
        window_to: planned ? chosenWindow.to : null,
    });

    const send = async () => {
        setSending(true);
        setProblems([]);

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
            if (json.problems && json.problems.length) {
                setProblems(json.problems);

                // If the server objects to something on step one — a stale
                // provider, a summary that passed the local check and not the
                // server's — go back to it. Reporting a field on the step it
                // is not on is the fault this split was supposed to remove.
                if (json.problems.some((p: any) => STEP_ONE_FIELDS.indexOf(p.field) !== -1)) {
                    setStep(1);
                }

                toast.error(
                    json.problems.length === 1
                        ? json.problems[0].message
                        : 'There are ' + json.problems.length + ' things to fill in.',
                    { theme: 'colored' }
                );
                return;
            }

            toast.error(json.error || 'Could not send that.', { theme: 'colored' });
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
                {/* No countdown, and no promise of a number. The release is a
                    safety net rather than an offer — see the long note above
                    URGENCY_LEVELS in lib/serviceEnquiries.ts. A host told to
                    wait twenty minutes for a phone number learns to pick
                    emergency and wait, and then nobody ever accepts anything. */}
                <p className="text-slate-600">
                    Your {sent.emergency ? 'emergency has' : 'enquiry has'} gone to{' '}
                    {provider.business_name}, and to nobody else.
                    {sent.emergency ? ' We have marked it urgent.' : ''} We will email you the moment
                    they answer, and tell you if they do not so you can try somebody else.
                </p>

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

    const footer = step === 1 ? (
        <button
            onClick={next}
            disabled={emergency && !canDoEmergency}
            className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-white font-semibold disabled:opacity-50"
        >
            Next
        </button>
    ) : (
        <div className="flex items-center gap-3">
            <button
                onClick={() => setStep(1)}
                className="rounded-xl border border-slate-300 px-4 py-3 text-slate-700 font-semibold"
            >
                Back
            </button>
            <button
                onClick={send}
                disabled={sending || (emergency && !canDoEmergency)}
                className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 text-white font-semibold disabled:opacity-50"
            >
                {sending ? 'Sending…' : 'Send to ' + provider.business_name}
            </button>
        </div>
    );

    return (
        <Shell
            onClose={onClose}
            title={step === 1 ? 'Ask ' + provider.business_name : 'When and who'}
            step={'Step ' + step + ' of 2'}
            footer={footer}
            scroller={scroller}
        >
            <div className="space-y-5" style={{ display: step === 1 ? undefined : 'none' }}>
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
                            What&rsquo;s wrong?
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
                    <span className="text-sm font-semibold text-slate-700">
                        Additional information{' '}
                        <span className="font-normal text-slate-500">
                            {faults.length ? '(optional)' : ''}
                        </span>
                    </span>
                    <textarea
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        rows={4}
                        placeholder="No hot water since Sunday. Combi boiler, about eight years old, pressure looks fine."
                        className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                    />
                    <Problem problems={problems} field="summary" />
                </label>
            </div>

            {/* Step two. Kept mounted rather than unmounted so that a value
                typed here survives a trip back to step one — remounting would
                quietly empty the date and the phone number every time somebody
                went back to reword the description. */}
            <div className="space-y-5" style={{ display: step === 2 ? undefined : 'none' }}>
                {planned && (
                    // No wrapper border. It used to sit in one, which put a
                    // bordered box inside a bordered box — boxy on a desktop,
                    // and on a phone its padding ate 32px of the width seven
                    // calendar columns have to share, dropping each day to
                    // 35px. The heading carries the group perfectly well.
                    <div className="space-y-3">
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

                        <div>
                            <span className="text-sm text-slate-700">Day</span>
                            <div className="mt-1.5">
                                <DatePicker value={preferredDate} onChange={setPreferredDate} />
                            </div>
                            <Problem problems={problems} field="preferred_date" />
                        </div>

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
                        <Problem problems={problems} field="host_name" />
                    </label>
                    <label className="block">
                        <span className="text-sm font-semibold text-slate-700">Phone</span>
                        <input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                        />
                        <Problem problems={problems} field="host_phone" />
                    </label>
                </div>

                <p className="text-xs text-slate-500">
                    They see your name and number now. The address goes across only if they say yes.
                </p>

            </div>
        </Shell>
    );
}

// The message for one field, under that field, where the person is looking.
// A toast says how many; this says which.
function Problem({ problems, field }: { problems: Array<{ field: string; message: string }>; field: string }) {
    const found = problems.filter((p) => p.field === field)[0];
    if (!found) return null;
    return <p className="text-sm text-red-700 mt-1">{found.message}</p>;
}

function Shell({
    children, onClose, title, step, footer, scroller,
}: {
    children: any;
    onClose: () => void;
    title: string;
    step?: string;
    footer?: any;
    scroller?: any;
}) {
    return (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start sm:items-center justify-center p-3 sm:p-6">
            {/*
                CAPPED, WITH THE FOOTER OUTSIDE THE SCROLL.

                The card was 1189px tall in a 760px window — and taller again
                on planned work, which adds the date block. The overlay could
                scroll, technically, but macOS hides overlay scrollbars until
                something moves, so it read as a form cut off at the bottom
                with the send button somewhere past the edge of the world.

                Splitting it in two shortens each step and does not fix that:
                two forms can both still run off a short window, or a phone in
                landscape. So the card is capped at the viewport, its middle
                scrolls, and the button lives in a footer that is always on
                screen. The scroll now has a visible edge — content meets a
                border instead of the end of the screen.
            */}
            <div className="w-full max-w-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] rounded-2xl bg-white shadow-xl flex flex-col overflow-hidden">
                <div className="flex items-start justify-between gap-4 px-4 sm:px-6 pt-6 pb-4 border-b border-slate-200">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
                        {step && <p className="text-xs text-slate-500 mt-0.5">{step}</p>}
                    </div>
                    <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div ref={scroller} className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
                    {children}
                </div>

                {footer && (
                    <div className="px-4 sm:px-6 py-4 border-t border-slate-200 bg-slate-50">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}
