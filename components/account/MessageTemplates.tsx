'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { Clock, Copy, Trash2, Plus, Home } from 'lucide-react';
import TemplateCoverage from '@/components/account/TemplateCoverage';

// Scheduled messages.
//
// Lifted out of app/account/page.tsx, which is 2,000 lines and also holds the
// profile, notifications, listings and booking permissions. This section was
// about 800 of them and had to be rebuilt from "one card per kind of message"
// to "a list of messages, each scoped to properties" — a rewrite that had no
// business happening in the middle of a file that big.
//
// The shape a host needs: three cottages means three different check-in
// messages, because where the lockbox is, which door, the parking and the
// directions are all different. So a message is a row, it carries the
// properties it applies to, and duplicating one and changing the property is
// the normal way to work.

// Turns a stored schedule into the sentence shown on the button.
function describeSchedule(t: { anchor: string; minutes_after: number; days_offset: number; send_hour: number; hours_after: number; hours_before: number }): string {
    const hh = (h: number) => (h < 10 ? `0${h}:00` : `${h}:00`);
    if (!t.anchor || t.anchor === 'none') return 'Not scheduled';
    if (t.anchor === 'booking') {
        if (!t.minutes_after) return 'As soon as you accept';
        if (t.minutes_after === 60) return '1 hour after booking confirmed';
        if (t.minutes_after % 60 === 0) return `${t.minutes_after / 60} hours after booking confirmed`;
        return `${t.minutes_after} minutes after booking confirmed`;
    }
    if (t.anchor === 'before_check_out') {
        if (t.hours_before === 1) return '1 hour before check-out';
        return `${t.hours_before} hours before check-out`;
    }
    if (t.anchor === 'after_check_in') {
        if (t.hours_after === 1) return '1 hour after check-in';
        return `${t.hours_after} hours after check-in`;
    }
    const when = t.anchor === 'check_in' ? 'check-in' : 'check-out';
    if (t.days_offset === 0) return `On the day of ${when} at ${hh(t.send_hour)}`;
    if (t.days_offset === 1) return `1 day before ${when} at ${hh(t.send_hour)}`;
    return `${t.days_offset} days before ${when} at ${hh(t.send_hour)}`;
}

interface Preset {
    label: string;
    values: { anchor: string; minutes_after: number; days_offset: number; send_hour: number; hours_after: number; hours_before: number };
}

const SCHEDULE_PRESETS: (Preset & { family: 'booking' | 'stay' | 'settled' | 'checkout' | 'both' })[] = [
    { family: 'both',    label: "Don't schedule",                       values: { anchor: 'none',      minutes_after: 0,  days_offset: 0, send_hour: 9, hours_after: 0, hours_before: 0 } },

    { family: 'booking', label: 'As soon as you accept a booking',      values: { anchor: 'booking',   minutes_after: 0,  days_offset: 0, send_hour: 9, hours_after: 0, hours_before: 0 } },
    { family: 'booking', label: '5 minutes after booking confirmed',    values: { anchor: 'booking',   minutes_after: 5,  days_offset: 0, send_hour: 9, hours_after: 0, hours_before: 0 } },
    { family: 'booking', label: '30 minutes after booking confirmed',   values: { anchor: 'booking',   minutes_after: 30, days_offset: 0, send_hour: 9, hours_after: 0, hours_before: 0 } },
    { family: 'booking', label: '1 hour after booking confirmed',       values: { anchor: 'booking',   minutes_after: 60, days_offset: 0, send_hour: 9, hours_after: 0, hours_before: 0 } },

    { family: 'stay',    label: '3 days before check-in at 10:00',      values: { anchor: 'check_in',  minutes_after: 0,  days_offset: 3, send_hour: 10, hours_after: 0, hours_before: 0 } },
    { family: 'stay',    label: '1 day before check-in at 10:00',       values: { anchor: 'check_in',  minutes_after: 0,  days_offset: 1, send_hour: 10, hours_after: 0, hours_before: 0 } },
    { family: 'settled', label: '1 hour after check-in',                values: { anchor: 'after_check_in', minutes_after: 0, days_offset: 0, send_hour: 9, hours_after: 1, hours_before: 0 } },
    { family: 'settled', label: '3 hours after check-in',               values: { anchor: 'after_check_in', minutes_after: 0, days_offset: 0, send_hour: 9, hours_after: 3, hours_before: 0 } },
    { family: 'settled', label: '5 hours after check-in',               values: { anchor: 'after_check_in', minutes_after: 0, days_offset: 0, send_hour: 9, hours_after: 5, hours_before: 0 } },

    { family: 'checkout', label: '24 hours before check-out',           values: { anchor: 'before_check_out', minutes_after: 0, days_offset: 0, send_hour: 9, hours_after: 0, hours_before: 24 } },
    { family: 'checkout', label: '18 hours before check-out',           values: { anchor: 'before_check_out', minutes_after: 0, days_offset: 0, send_hour: 9, hours_after: 0, hours_before: 18 } },
    { family: 'checkout', label: '12 hours before check-out',           values: { anchor: 'before_check_out', minutes_after: 0, days_offset: 0, send_hour: 9, hours_after: 0, hours_before: 12 } },
    { family: 'checkout', label: '4 hours before check-out',            values: { anchor: 'before_check_out', minutes_after: 0, days_offset: 0, send_hour: 9, hours_after: 0, hours_before: 4 } },
];

const ANCHOR_LABELS: { key: string; label: string }[] = [
    { key: 'booking',   label: 'after you accept a booking' },
    { key: 'check_in',  label: 'before check-in' },
    { key: 'check_out', label: 'before check-out' },
];

// Every template opens with this. Hosts can edit or remove it, but it's
// there by default so a guest is always greeted by name.
const GREETING = 'Hi {guest_name},\n\n';

const PLACEHOLDERS = [
    { token: '{guest_name}', label: 'Guest first name' },
    { token: '{listing}',    label: 'Listing name' },
    { token: '{check_in}',   label: 'Check-in date' },
    { token: '{check_out}',  label: 'Check-out date' },
    // The one that resolves per property rather than per booking. Set the
    // code on each listing and one message covers them all with the right
    // code each time — which is the point, since a template cannot be written
    // per property. A listing with no code set holds the message back rather
    // than sending it with a gap in it.
    { token: '{lockbox_code}', label: 'Door code for that property' },
];

// True only if the host has written something beyond the stock greeting.
function hasRealContent(body: string): boolean {
    return body.split(GREETING).join('').trim().length > 0;
}


// A textarea can't colour parts of its own text, so a styled copy of the
// text sits directly behind one whose own text is transparent. The catch
// is that both layers must lay text out identically down to the pixel —
// so every property that affects text metrics is set inline here, on
// both, rather than through classes that might resolve differently for a
// div and a textarea.
const EDITOR_TEXT_STYLE: React.CSSProperties = {
    margin: 0,
    padding: '12px',
    border: '1px solid transparent',
    fontFamily: 'inherit',
    fontSize: '14px',
    lineHeight: '24px',
    letterSpacing: 'normal',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    wordBreak: 'normal',
    tabSize: 4,
    boxSizing: 'border-box',
    width: '100%',
};

function HighlightedTemplate({
    value,
    onChange,
    onCaret,
    innerRef,
    placeholder,
    rows = 6,
}: {
    value: string;
    onChange: (next: string, caret: number) => void;
    onCaret: (caret: number) => void;
    innerRef: (el: HTMLTextAreaElement | null) => void;
    placeholder?: string;
    rows?: number;
}) {
    const backdropRef = React.useRef<HTMLDivElement>(null);
    const height = `${rows * 24 + 26}px`;

    const tokens = PLACEHOLDERS.map((ph) => ph.token);
    const parts: React.ReactNode[] = [];
    let remaining = value;
    let guard = 0;

    while (remaining.length > 0 && guard < 800) {
        guard += 1;

        let nextAt = -1;
        let nextToken = '';
        tokens.forEach((tok) => {
            const at = remaining.indexOf(tok);
            if (at !== -1 && (nextAt === -1 || at < nextAt)) {
                nextAt = at;
                nextToken = tok;
            }
        });

        if (nextAt === -1) {
            parts.push(remaining);
            break;
        }

        if (nextAt > 0) parts.push(remaining.slice(0, nextAt));
        parts.push(
            <span
                key={`${guard}-${nextAt}`}
                style={{
                    backgroundColor: '#dbeafe',
                    color: '#1e40af',
                    borderRadius: '3px',
                }}
            >
                {nextToken}
            </span>
        );
        remaining = remaining.slice(nextAt + nextToken.length);
    }

    return (
        <div
            style={{ position: 'relative', height }}
            className="border rounded-lg bg-white overflow-hidden"
        >
            <div
                ref={backdropRef}
                aria-hidden="true"
                style={Object.assign({}, EDITOR_TEXT_STYLE, {
                    position: 'absolute',
                    inset: 0,
                    height: '100%',
                    overflow: 'hidden',
                    color: '#1e293b',
                    pointerEvents: 'none',
                })}
            >
                {value ? parts : <span style={{ color: '#94a3b8' }}>{placeholder}</span>}
                {'\n'}
            </div>

            <textarea
                ref={innerRef}
                value={value}
                onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
                onSelect={(e) => onCaret(e.currentTarget.selectionStart)}
                onKeyUp={(e) => onCaret(e.currentTarget.selectionStart)}
                onClick={(e) => onCaret(e.currentTarget.selectionStart)}
                onScroll={(e) => {
                    if (backdropRef.current) {
                        backdropRef.current.scrollTop = e.currentTarget.scrollTop;
                    }
                }}
                spellCheck={false}
                style={Object.assign({}, EDITOR_TEXT_STYLE, {
                    position: 'absolute',
                    inset: 0,
                    height: '100%',
                    resize: 'none',
                    background: 'transparent',
                    color: 'transparent',
                    caretColor: '#0f172a',
                    outline: 'none',
                    overflowY: 'auto',
                })}
            />
        </div>
    );
}




const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

interface TemplateDef {
    key: string;
    label: string;
    hint: string;
    placeholder: string;
    defaultOffset: number;
    // Which kind of timing makes sense: hung off the booking being
    // accepted, or off the dates of the stay itself.
    family: 'booking' | 'stay' | 'settled' | 'checkout';
    offsetLabel?: string;
    offsetChoices?: number[];
}

const TEMPLATE_TYPES: TemplateDef[] = [
    {
        key: 'booking_confirmation',
        family: 'booking',
        label: 'Booking confirmation',
        hint: 'Sent the moment you accept a booking request.',
        placeholder: "Thanks for booking {listing}! I've confirmed your stay from {check_in} to {check_out}. Any questions before you arrive, just reply here.",
        defaultOffset: 0,
    },
    {
        key: 'checkin_details',
        family: 'stay',
        label: 'Check-in details',
        hint: 'The practical stuff — address, key safe, parking, wifi.',
        placeholder: "You're arriving at {listing} on {check_in}. Check-in is any time after 3pm. The key safe is to the right of the front door — code 1234. Parking is on the street directly outside.",
        defaultOffset: 3,
        offsetLabel: 'days before arrival',
        offsetChoices: [1, 2, 3, 4, 5, 6, 7, 10, 14],
    },
    {
        key: 'checkin_day',
        family: 'settled',
        label: 'Checking in with guest',
        hint: 'A friendly note once they\'ve arrived and had a chance to settle in.',
        placeholder: "Just checking you got in alright and everything's as you expected at {listing}. Any problems at all, give me a shout and I'll sort it.",
        defaultOffset: 0,
    },
    {
        key: 'checkout_details',
        family: 'checkout',
        label: 'Check-out details',
        hint: 'What you need them to do before they leave — counted back from your check-out time.',
        placeholder: "Hope you've had a lovely stay. Check-out is by 11am on {check_out} — just pop the keys back in the safe and close the door behind you. Bins are round the side if you have any rubbish.",
        defaultOffset: 1,
        offsetLabel: 'days before departure',
        offsetChoices: [1, 2, 3],
    },
];
/* ------------------------------------------------------------------ types */

interface Template {
    id: string;
    template_type: string;
    // The host's own label for this one. Never sent, never shown to a guest —
    // with three check-in messages the kind is no longer a name.
    name: string;
    body: string;
    enabled: boolean;
    anchor: string;
    days_offset: number;
    send_hour: number;
    minutes_after: number;
    hours_after: number;
    hours_before: number;
    created_at?: string | null;
    // Which properties it applies to. Empty means all of them.
    listingIds: string[];
}

interface Listing {
    id: string;
    title: string;
}

const defOf = (type: string) => TEMPLATE_TYPES.filter((d) => d.key === type)[0] || TEMPLATE_TYPES[0];

/* -------------------------------------------------------------- component */

export default function MessageTemplates() {
    const supabase = createClientComponentClient();

    const [userId, setUserId] = useState('');
    const [rows, setRows] = useState<Template[]>([]);
    const [listings, setListings] = useState<Listing[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [scheduleFor, setScheduleFor] = useState<string | null>(null);
    const [listingsFor, setListingsFor] = useState<string | null>(null);
    const [draftSchedule, setDraftSchedule] = useState<Partial<Template>>({});
    const [draftListingIds, setDraftListingIds] = useState<string[]>([]);
    // Bumped after any change so the coverage grid re-reads rather than
    // showing what was true a minute ago.
    const [coverageKey, setCoverageKey] = useState(0);

    const boxRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
    const caretRefs = useRef<Record<string, number>>({});

    const load = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { setLoading(false); return; }
        setUserId(session.user.id);

        const [tplRes, listRes] = await Promise.all([
            supabase
                .from('message_templates')
                .select('id, template_type, name, body, enabled, anchor, days_offset, send_hour, minutes_after, hours_after, hours_before, created_at')
                .eq('user_id', session.user.id),
            supabase
                .from('listings')
                .select('id, title, status')
                .eq('host_id', session.user.id)
                .order('created_at', { ascending: true }),
        ]);

        const tpls = tplRes.data || [];

        const scopeRes = tpls.length
            ? await supabase
                .from('message_template_listings')
                .select('template_id, listing_id')
                .in('template_id', tpls.map((t: any) => t.id))
            : { data: [] as any[] };

        const scopeOf: Record<string, string[]> = {};
        (scopeRes.data || []).forEach((r: any) => {
            if (!scopeOf[r.template_id]) scopeOf[r.template_id] = [];
            scopeOf[r.template_id].push(r.listing_id);
        });

        setRows(tpls.map((t: any) => ({
            ...t,
            name: t.name || defOf(t.template_type).label,
            anchor: t.anchor || 'none',
            days_offset: t.days_offset || 0,
            send_hour: t.send_hour ?? 9,
            minutes_after: t.minutes_after || 0,
            hours_after: t.hours_after || 0,
            hours_before: t.hours_before || 0,
            listingIds: scopeOf[t.id] || [],
        })));

        setListings((listRes.data || [])
            .filter((l: any) => l.status !== 'draft')
            .map((l: any) => ({ id: l.id, title: l.title || 'Untitled listing' })));

        setLoading(false);
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const patchLocal = (id: string, patch: Partial<Template>) => {
        setRows((prev) => prev.map((r) => (r.id === id ? Object.assign({}, r, patch) : r)));
    };

    const rowOf = (id: string) => rows.filter((r) => r.id === id)[0];

    /* ------------------------------------------------------------- saving */

    const save = async (id: string, patch?: Partial<Template>) => {
        const current = rowOf(id);
        if (!current) return;
        const next = Object.assign({}, current, patch || {});

        setBusyId(id);
        const { error } = await supabase
            .from('message_templates')
            .update({
                name: (next.name || '').trim() || defOf(next.template_type).label,
                body: next.body,
                enabled: next.enabled,
                anchor: next.anchor,
                days_offset: next.days_offset,
                send_hour: next.send_hour,
                minutes_after: next.minutes_after,
                hours_after: next.hours_after,
                hours_before: next.hours_before,
            })
            .eq('id', id);
        setBusyId(null);

        if (error) { toast.error(error.message, { theme: 'colored' }); return; }

        patchLocal(id, next);
        setCoverageKey((k) => k + 1);
        toast.success('Saved.', { theme: 'colored' });
    };

    const add = async (type: string) => {
        if (!userId) return;
        setAdding(false);
        setBusyId('new');

        const def = defOf(type);
        const { data, error } = await supabase
            .from('message_templates')
            .insert({
                user_id: userId,
                template_type: type,
                name: def.label,
                body: GREETING,
                enabled: false,
                anchor: def.family === 'booking' ? 'booking' : def.family === 'settled' ? 'after_check_in' : def.family === 'checkout' ? 'before_check_out' : 'check_in',
                days_offset: def.defaultOffset,
                send_hour: 9,
                minutes_after: 0,
                hours_after: 0,
                hours_before: def.family === 'checkout' ? 18 : 0,
                // Still written for now: the old code is briefly still
                // deployed and reads it. Scope proper lives in the join table.
                listing_ids: [],
            })
            .select('id, template_type, name, body, enabled, anchor, days_offset, send_hour, minutes_after, hours_after, hours_before, created_at')
            .maybeSingle();

        setBusyId(null);
        if (error || !data) { toast.error((error && error.message) || 'Could not add it.', { theme: 'colored' }); return; }

        setRows((prev) => prev.concat([{ ...(data as any), listingIds: [] }]));
        setCoverageKey((k) => k + 1);
    };

    // Duplicating and changing the property is how a host with three cottages
    // actually works, so the copy starts scoped to nothing and switched off —
    // it must not begin sending the original's text to somewhere it does not
    // describe.
    const duplicate = async (id: string) => {
        const source = rowOf(id);
        if (!source || !userId) return;

        setBusyId(id);
        const { data, error } = await supabase
            .from('message_templates')
            .insert({
                user_id: userId,
                template_type: source.template_type,
                // Named properly once it is scoped — see saveScope. Until
                // then it must not read as a second copy of the original.
                name: defOf(source.template_type).label + ' (copy)',
                body: source.body,
                enabled: false,
                anchor: source.anchor,
                days_offset: source.days_offset,
                send_hour: source.send_hour,
                minutes_after: source.minutes_after,
                hours_after: source.hours_after,
                hours_before: source.hours_before,
                listing_ids: [],
            })
            .select('id, template_type, name, body, enabled, anchor, days_offset, send_hour, minutes_after, hours_after, hours_before, created_at')
            .maybeSingle();

        setBusyId(null);
        if (error || !data) { toast.error((error && error.message) || 'Could not duplicate it.', { theme: 'colored' }); return; }

        setRows((prev) => prev.concat([{ ...(data as any), listingIds: [] }]));
        setCoverageKey((k) => k + 1);
        toast.success('Copied. Choose its properties, then switch it on.', { theme: 'colored' });
    };

    const remove = async (id: string) => {
        const row = rowOf(id);
        if (!row) return;
        if (!window.confirm('Delete this message? Guests will stop receiving it.')) return;

        setBusyId(id);
        const { error } = await supabase.from('message_templates').delete().eq('id', id);
        setBusyId(null);

        if (error) { toast.error(error.message, { theme: 'colored' }); return; }

        setRows((prev) => prev.filter((r) => r.id !== id));
        setCoverageKey((k) => k + 1);
        toast.success('Deleted.', { theme: 'colored' });
    };

    /* -------------------------------------------------------------- scope */

    const saveScope = async () => {
        const id = listingsFor;
        if (!id) return;
        const current = rowOf(id);
        if (!current) return;

        setBusyId(id);

        // Replace wholesale: work out what changed rather than deleting
        // everything and putting it back, so a concurrent read never sees a
        // template briefly scoped to nothing and treats it as the catch-all.
        const before = current.listingIds;
        const after = draftListingIds;
        const gone = before.filter((l) => after.indexOf(l) === -1);
        const added = after.filter((l) => before.indexOf(l) === -1);

        if (gone.length) {
            await supabase
                .from('message_template_listings')
                .delete()
                .eq('template_id', id)
                .in('listing_id', gone);
        }

        let failed = '';
        if (added.length) {
            const { error } = await supabase
                .from('message_template_listings')
                .insert(added.map((listing_id) => ({ template_id: id, listing_id })));

            if (error) {
                // 23505 is the index that stops two messages of one kind
                // naming the same property — the rule that keeps a guest from
                // getting another cottage's door code.
                failed = String((error as any).code) === '23505'
                    ? 'Another ' + defOf(current.template_type).label.toLowerCase()
                        + ' message already covers one of those properties. A property can only be on one.'
                    : error.message;
            }
        }

        setBusyId(null);

        if (failed) {
            toast.error(failed, { theme: 'colored' });
            await load();
            setListingsFor(null);
            return;
        }

        // Name it after the property, which is the point of duplicating one.
        // Only when the name is still one we generated: a host who has typed
        // their own must keep it.
        const label = defOf(current.template_type).label;
        const autoNamed = current.name === label || current.name === label + ' (copy)';
        let renamed = current.name;

        if (autoNamed && after.length === 1) {
            const l = listings.filter((x) => x.id === after[0])[0];
            if (l) renamed = label + ' — ' + l.title;
        }

        patchLocal(id, { listingIds: after, name: renamed });

        if (renamed !== current.name) {
            await supabase.from('message_templates').update({ name: renamed }).eq('id', id);
        }
        // listing_ids is vestigial but still read by the currently deployed
        // code until this ships, so it is kept in step rather than left to rot.
        await supabase.from('message_templates').update({ listing_ids: after }).eq('id', id);

        setListingsFor(null);
        setCoverageKey((k) => k + 1);
        toast.success('Properties updated.', { theme: 'colored' });
    };

    /* -------------------------------------------------- placeholder insert */

    const insertPlaceholder = (id: string, token: string) => {
        const el = boxRefs.current[id];
        const current = rowOf(id)?.body || '';
        const start = el ? el.selectionStart : (caretRefs.current[id] ?? current.length);
        const end = el ? el.selectionEnd : start;

        patchLocal(id, { body: current.slice(0, start) + token + current.slice(end) });

        const caret = start + token.length;
        caretRefs.current[id] = caret;
        setTimeout(() => {
            const box = boxRefs.current[id];
            if (box) { box.focus(); box.setSelectionRange(caret, caret); }
        }, 0);
    };

    const scopeLabel = (t: Template) => {
        if (t.listingIds.length === 0) return 'All properties';
        if (t.listingIds.length === 1) {
            const l = listings.filter((x) => x.id === t.listingIds[0])[0];
            return l ? l.title : '1 property';
        }
        return t.listingIds.length + ' properties';
    };

    // Grouped by kind, so the list reads as "these are your check-in messages"
    // rather than as a pile.
    const ordered = TEMPLATE_TYPES.map((def) => ({
        def,
        items: rows
            .filter((r) => r.template_type === def.key)
            .sort((a, b) => String(a.created_at || '') < String(b.created_at || '') ? -1 : 1),
    }));

    if (loading) {
        return <p className="text-sm text-slate-400">Loading your messages…</p>;
    }

    return (
        <div>
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                <div>
                    <h3 className="text-base font-bold text-slate-900 mb-1">Scheduled messages</h3>
                    <p className="text-xs text-slate-500 max-w-xl">
                        Written once, sent automatically at the right moment. Anything highlighted in
                        blue is swapped for the real thing when the message goes out. A message can
                        cover all your properties, or just some &mdash; so a cottage with a different
                        door and a different lockbox can have its own. The name at the top of each
                        is for this list only; a guest never sees it.
                    </p>
                </div>

                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setAdding(!adding)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg"
                    >
                        <Plus className="w-4 h-4" /> Add a message
                    </button>

                    {adding && (
                        <div className="absolute right-0 mt-2 w-64 bg-white border rounded-xl shadow-lg z-20 p-1">
                            {TEMPLATE_TYPES.map((def) => (
                                <button
                                    key={def.key}
                                    type="button"
                                    onClick={() => add(def.key)}
                                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100"
                                >
                                    <div className="text-sm font-medium text-slate-900">{def.label}</div>
                                    <div className="text-xs text-slate-500">{def.hint}</div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="space-y-6">
                {ordered.map(({ def, items }) => (
                    <div key={def.key}>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                            {def.label}
                        </div>

                        {items.length === 0 ? (
                            <div className="border border-dashed rounded-xl p-4 text-sm text-slate-500">
                                None set up. {def.hint}{' '}
                                <button
                                    type="button"
                                    onClick={() => add(def.key)}
                                    className="font-semibold text-slate-900 underline"
                                >
                                    Add one
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {items.map((tpl) => {
                                    const busy = busyId === tpl.id;
                                    return (
                                        <div key={tpl.id} className="border rounded-xl p-4">
                                            <input
                                                type="text"
                                                value={tpl.name}
                                                onChange={(e) => patchLocal(tpl.id, { name: e.target.value })}
                                                onBlur={() => save(tpl.id)}
                                                placeholder={def.label}
                                                aria-label="Name for your own list"
                                                className="w-full font-semibold text-slate-900 bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-slate-900 focus:outline-none mb-3 px-0 py-1"
                                            />

                                            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                                                <button
                                                    type="button"
                                                    onClick={() => { setDraftListingIds(tpl.listingIds); setListingsFor(tpl.id); }}
                                                    className="inline-flex items-center gap-2 px-3 py-1.5 border rounded-lg text-sm font-medium text-slate-800 hover:border-slate-900"
                                                >
                                                    <Home className="w-3.5 h-3.5 text-slate-500" />
                                                    {scopeLabel(tpl)}
                                                </button>

                                                <div className="flex items-center gap-1 ml-auto">
                                                    <button
                                                        type="button"
                                                        title="Duplicate"
                                                        onClick={() => duplicate(tpl.id)}
                                                        disabled={busy}
                                                        className="p-2 text-slate-500 hover:text-slate-900 disabled:opacity-40"
                                                    >
                                                        <Copy className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title="Delete"
                                                        onClick={() => remove(tpl.id)}
                                                        disabled={busy}
                                                        className="p-2 text-slate-500 hover:text-red-600 disabled:opacity-40"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => save(tpl.id, { enabled: !tpl.enabled })}
                                                        disabled={busy}
                                                        className={`ml-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                                                            tpl.enabled
                                                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                                                : 'bg-slate-50 border-slate-200 text-slate-500'
                                                        }`}
                                                    >
                                                        {tpl.enabled ? 'On' : 'Off'}
                                                    </button>
                                                </div>
                                            </div>

                                            <HighlightedTemplate
                                                value={tpl.body}
                                                onChange={(next, caret) => {
                                                    patchLocal(tpl.id, { body: next });
                                                    caretRefs.current[tpl.id] = caret;
                                                }}
                                                onCaret={(caret) => { caretRefs.current[tpl.id] = caret; }}
                                                innerRef={(el) => { boxRefs.current[tpl.id] = el; }}
                                                placeholder={def.placeholder}
                                            />

                                            <div className="flex flex-wrap gap-1.5 mt-2">
                                                {PLACEHOLDERS.map((ph) => (
                                                    <button
                                                        key={ph.token}
                                                        type="button"
                                                        onClick={() => insertPlaceholder(tpl.id, ph.token)}
                                                        title={ph.label}
                                                        className="text-xs px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700"
                                                    >
                                                        {ph.token}
                                                    </button>
                                                ))}
                                            </div>

                                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                                                <button
                                                    type="button"
                                                    onClick={() => { setScheduleFor(tpl.id); setDraftSchedule(tpl); }}
                                                    className="inline-flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm text-slate-700 hover:border-slate-900"
                                                >
                                                    <Clock className="w-3.5 h-3.5" />
                                                    {describeSchedule(tpl)}
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => save(tpl.id)}
                                                    disabled={busy}
                                                    className="ml-auto px-4 py-2 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-40"
                                                >
                                                    {busy ? 'Saving...' : 'Save'}
                                                </button>
                                            </div>

                                            {tpl.enabled && !hasRealContent(tpl.body) && (
                                                <p className="text-xs text-amber-600 mt-3">
                                                    Switched on but nothing written, so nothing will be sent.
                                                </p>
                                            )}
                                            {tpl.enabled && hasRealContent(tpl.body) && tpl.anchor === 'none' && (
                                                <p className="text-xs text-amber-600 mt-3">
                                                    Switched on but not scheduled, so nothing will be sent. Pick a time.
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <TemplateCoverage key={coverageKey} />

            {/* Which properties this message covers. */}
            {listingsFor && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setListingsFor(null)}>
                    <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                        <h4 className="font-bold text-slate-900 mb-1">Which properties?</h4>
                        <p className="text-sm text-slate-500 mb-4">
                            Choose none to cover all of them. A property already covered by another
                            message of this kind cannot be added to a second.
                        </p>

                        <label className="flex items-center gap-2 text-sm text-slate-800 mb-3">
                            <input
                                type="checkbox"
                                checked={draftListingIds.length === 0}
                                onChange={() => setDraftListingIds([])}
                            />
                            All properties
                        </label>

                        <div className="space-y-2 max-h-64 overflow-y-auto border-t pt-3">
                            {listings.map((l) => (
                                <label key={l.id} className="flex items-center gap-2 text-sm text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={draftListingIds.indexOf(l.id) !== -1}
                                        onChange={(e) => setDraftListingIds((prev) =>
                                            e.target.checked
                                                ? prev.concat([l.id])
                                                : prev.filter((x) => x !== l.id)
                                        )}
                                    />
                                    {l.title}
                                </label>
                            ))}
                        </div>

                        <div className="flex justify-end gap-2 mt-5">
                            <button type="button" onClick={() => setListingsFor(null)} className="px-4 py-2 text-sm font-semibold text-slate-600">
                                Cancel
                            </button>
                            <button type="button" onClick={saveScope} className="px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg">
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* When it sends. */}
            {scheduleFor && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setScheduleFor(null)}>
                    <div className="bg-white rounded-2xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
                        <h4 className="font-bold text-slate-900 mb-4">When should this send?</h4>

                        <div className="space-y-2">
                            {SCHEDULE_PRESETS.filter((preset) => {
                                const def = defOf(rowOf(scheduleFor)?.template_type || '');
                                return preset.family === 'both' || preset.family === def.family;
                            }).map((preset) => {
                                const on =
                                    draftSchedule.anchor === preset.values.anchor &&
                                    (draftSchedule.minutes_after || 0) === preset.values.minutes_after &&
                                    (draftSchedule.days_offset || 0) === preset.values.days_offset &&
                                    (draftSchedule.send_hour || 0) === preset.values.send_hour &&
                                    (draftSchedule.hours_after || 0) === preset.values.hours_after &&
                                    (draftSchedule.hours_before || 0) === preset.values.hours_before;

                                return (
                                    <button
                                        key={preset.label}
                                        type="button"
                                        onClick={() => setDraftSchedule(Object.assign({}, draftSchedule, preset.values))}
                                        className={`w-full text-left px-4 py-2.5 rounded-xl border text-sm ${
                                            on ? 'border-slate-900 bg-slate-50 font-semibold' : 'border-slate-200 hover:border-slate-400'
                                        }`}
                                    >
                                        {preset.label}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex justify-end gap-2 mt-5">
                            <button type="button" onClick={() => setScheduleFor(null)} className="px-4 py-2 text-sm font-semibold text-slate-600">
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const id = scheduleFor;
                                    setScheduleFor(null);
                                    if (id) save(id, draftSchedule);
                                }}
                                className="px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
