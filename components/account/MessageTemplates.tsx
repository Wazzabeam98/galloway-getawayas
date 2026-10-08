'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { Clock, Copy, Trash2, Plus, Home } from 'lucide-react';
import TemplateCoverage from '@/components/account/TemplateCoverage';
import { TEMPLATE_TYPES, templateDefFor } from '@/lib/templateTypes';
import { CUSTOM_TYPE } from '@/lib/messageTemplates';

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

// Turns a stored schedule into the sentence shown on the button. Shared by the
// four fixed types and a host's own custom messages, so it reads any anchor and
// any offset — and renders a round number of hours as days where that is how a
// host would say it ("1 day before check-out", not "24 hours").
function describeSchedule(t: { anchor: string; minutes_after: number; days_offset: number; send_hour: number; hours_after: number; hours_before: number }): string {
    const hh = (h: number) => (h < 10 ? `0${h}:00` : `${h}:00`);
    const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    // A span given in hours, said in days when it divides cleanly.
    const span = (hours: number) => (hours >= 24 && hours % 24 === 0) ? unit(hours / 24, 'day') : unit(hours, 'hour');

    if (!t.anchor || t.anchor === 'none') return 'Not scheduled';
    if (t.anchor === 'booking') {
        const m = t.minutes_after || 0;
        if (!m) return 'As soon as you accept';
        if (m % 1440 === 0) return `${unit(m / 1440, 'day')} after booking confirmed`;
        if (m % 60 === 0) return `${unit(m / 60, 'hour')} after booking confirmed`;
        return `${unit(m, 'minute')} after booking confirmed`;
    }
    if (t.anchor === 'after_check_in') return `${span(t.hours_after || 0)} after check-in`;
    if (t.anchor === 'after_check_out') return `${span(t.hours_after || 0)} after check-out`;
    if (t.anchor === 'before_check_out') return `${span(t.hours_before || 0)} before check-out`;

    const when = t.anchor === 'check_in' ? 'check-in' : 'check-out';
    if ((t.days_offset || 0) === 0) return `On the day of ${when} at ${hh(t.send_hour)}`;
    return `${unit(t.days_offset, 'day')} before ${when} at ${hh(t.send_hour)}`;
}

// A host's own message is scheduled by picking a trigger from the guest journey
// and a free amount of time from it — not one of the fixed presets the four
// purposes use. These are the triggers; the editor shows the right unit for each.
const CUSTOM_TRIGGERS: { anchor: string; label: string; units: ('minutes' | 'hours' | 'days')[]; timeOfDay: boolean }[] = [
    { anchor: 'booking',          label: 'After you accept the booking', units: ['minutes', 'hours', 'days'], timeOfDay: false },
    { anchor: 'check_in',         label: 'Before check-in',              units: ['days'],                     timeOfDay: true },
    { anchor: 'after_check_in',   label: 'After check-in',               units: ['hours', 'days'],            timeOfDay: false },
    { anchor: 'before_check_out', label: 'Before check-out',             units: ['hours', 'days'],            timeOfDay: false },
    { anchor: 'after_check_out',  label: 'After check-out',              units: ['hours', 'days'],            timeOfDay: false },
];

type Unit = 'minutes' | 'hours' | 'days';

// The amount + unit a stored custom schedule reads back as, for the editor.
function amountUnitOf(d: { anchor: string; minutes_after: number; days_offset: number; hours_after: number; hours_before: number }): { amount: number; unit: Unit } {
    if (d.anchor === 'booking') {
        const m = d.minutes_after || 0;
        if (m && m % 1440 === 0) return { amount: m / 1440, unit: 'days' };
        if (m && m % 60 === 0) return { amount: m / 60, unit: 'hours' };
        return { amount: m, unit: 'minutes' };
    }
    if (d.anchor === 'check_in' || d.anchor === 'check_out') {
        return { amount: d.days_offset || 0, unit: 'days' };
    }
    const h = d.anchor === 'before_check_out' ? (d.hours_before || 0) : (d.hours_after || 0);
    if (h && h % 24 === 0) return { amount: h / 24, unit: 'days' };
    return { amount: h, unit: 'hours' };
}

// Turn a trigger + amount + unit (+ time of day) into the offset columns. The
// engine reads these; this is the only place the custom editor writes them.
function scheduleColumns(anchor: string, amount: number, unit: Unit, sendHour: number): Partial<Template> {
    const n = Math.max(0, Math.round(amount || 0));
    const base = { anchor, minutes_after: 0, days_offset: 0, send_hour: sendHour, hours_after: 0, hours_before: 0 };
    if (anchor === 'booking') {
        return { ...base, minutes_after: unit === 'days' ? n * 1440 : unit === 'hours' ? n * 60 : n };
    }
    if (anchor === 'check_in') {
        return { ...base, days_offset: n };
    }
    const hours = unit === 'days' ? n * 24 : n;
    if (anchor === 'before_check_out') return { ...base, hours_before: hours };
    // after_check_in / after_check_out
    return { ...base, hours_after: hours };
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

// The example shown in an empty custom message — a nudge, not one of the four
// purposes.
const CUSTOM_PLACEHOLDER = "A note of your own — a welcome pack, local tips, a mid-stay check, a thank-you after they leave. Use {guest_name} and {listing} and they're filled in for each guest.";

// The fallback label when a host leaves a message unnamed. A custom message has
// no fixed purpose to borrow a name from, so it gets a neutral one.
function defaultName(type: string): string {
    return type === CUSTOM_TYPE ? 'Your message' : templateDefFor(type).label;
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

const defOf = templateDefFor;

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
                name: (next.name || '').trim() || defaultName(next.template_type),
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

        const isCustom = type === CUSTOM_TYPE;
        const def = isCustom ? null : defOf(type);
        // A custom message starts a couple of hours after check-in — a real,
        // editable schedule rather than "not scheduled", so the host adjusts one
        // thing rather than setting it from nothing.
        const anchor = isCustom
            ? 'after_check_in'
            : def!.family === 'booking' ? 'booking'
            : def!.family === 'settled' ? 'after_check_in'
            : def!.family === 'checkout' ? 'before_check_out'
            : 'check_in';

        const { data, error } = await supabase
            .from('message_templates')
            .insert({
                user_id: userId,
                template_type: type,
                name: defaultName(type),
                body: GREETING,
                enabled: false,
                anchor,
                days_offset: isCustom ? 0 : def!.defaultOffset,
                send_hour: 9,
                minutes_after: 0,
                hours_after: isCustom ? 2 : 0,
                hours_before: !isCustom && def!.family === 'checkout' ? 18 : 0,
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
                // then it must not read as a second copy of the original. A
                // custom message keeps the host's own name, which saveScope
                // leaves alone.
                name: (source.template_type === CUSTOM_TYPE ? source.name : defOf(source.template_type).label) + ' (copy)',
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

    // A host's own messages — any number, each with its own trigger and timing.
    const customItems = rows
        .filter((r) => r.template_type === CUSTOM_TYPE)
        .sort((a, b) => String(a.created_at || '') < String(b.created_at || '') ? -1 : 1);

    // One card, used by the four fixed groups and by the host's own messages.
    // A plain function, not a nested component, so the parent re-rendering on a
    // keystroke never remounts the body textarea and drops the caret.
    const renderCard = (tpl: Template, bodyPlaceholder: string, namePlaceholder: string) => {
        const busy = busyId === tpl.id;
        return (
            <div key={tpl.id} className="border rounded-xl p-4">
                <input
                    type="text"
                    value={tpl.name}
                    onChange={(e) => patchLocal(tpl.id, { name: e.target.value })}
                    onBlur={() => save(tpl.id)}
                    placeholder={namePlaceholder}
                    aria-label="A name for this message — just for you, never shown to a guest"
                    title="Just for you — a guest never sees this name"
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
                    placeholder={bodyPlaceholder}
                />

                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="text-xs text-slate-400 mr-1">Filled in when it sends:</span>
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
    };

    // Roughly the shape of what is about to arrive, so the rest of the
    // Messaging section does not slide up the page when it does.
    if (loading) {
        return (
            <div className="animate-pulse mb-10">
                <div className="h-5 w-48 bg-slate-100 rounded mb-3" />
                <div className="h-3 w-full max-w-xl bg-slate-100 rounded mb-2" />
                <div className="h-3 w-2/3 max-w-md bg-slate-100 rounded mb-6" />
                <div className="h-40 bg-slate-100 rounded-2xl" />
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                <div>
                    <h3 className="text-base font-bold text-slate-900 mb-1">Scheduled messages</h3>
                    <p className="text-xs text-slate-500 max-w-xl">
                        Written once, sent automatically at the right moment.
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
                            <div className="my-1 border-t" />
                            <button
                                type="button"
                                onClick={() => add(CUSTOM_TYPE)}
                                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100"
                            >
                                <div className="text-sm font-medium text-slate-900">Your own message</div>
                                <div className="text-xs text-slate-500">Write your own, and choose exactly when it sends.</div>
                            </button>
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
                                {items.map((tpl) => renderCard(tpl, def.placeholder, def.label))}
                            </div>
                        )}
                    </div>
                ))}

                {/* The host's own messages — any trigger, any timing, as many
                    as they like. Kept out of the coverage grid above, which is
                    about the four purposes a stay needs covered. */}
                <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                        Your own messages
                    </div>
                    {customItems.length === 0 ? (
                        <div className="border border-dashed rounded-xl p-4 text-sm text-slate-500">
                            Write your own — a welcome pack, a mid-stay check, a thank-you after
                            checkout — and choose exactly when it sends.{' '}
                            <button
                                type="button"
                                onClick={() => add(CUSTOM_TYPE)}
                                className="font-semibold text-slate-900 underline"
                            >
                                Create one
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {customItems.map((tpl) => renderCard(tpl, CUSTOM_PLACEHOLDER, 'Name this message'))}
                            <button
                                type="button"
                                onClick={() => add(CUSTOM_TYPE)}
                                className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-black"
                            >
                                <Plus className="w-4 h-4" /> Create another
                            </button>
                        </div>
                    )}
                </div>
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

                        {rowOf(scheduleFor)?.template_type === CUSTOM_TYPE ? (
                            // A host's own message: pick a trigger from the guest
                            // journey and a free amount of time from it.
                            (() => {
                                const anchor = draftSchedule.anchor && draftSchedule.anchor !== 'none'
                                    ? draftSchedule.anchor
                                    : 'after_check_in';
                                const trig = CUSTOM_TRIGGERS.filter((t) => t.anchor === anchor)[0] || CUSTOM_TRIGGERS[0];
                                const au = amountUnitOf({
                                    anchor,
                                    minutes_after: draftSchedule.minutes_after || 0,
                                    days_offset: draftSchedule.days_offset || 0,
                                    hours_after: draftSchedule.hours_after || 0,
                                    hours_before: draftSchedule.hours_before || 0,
                                });
                                const sendHour = draftSchedule.send_hour ?? 9;
                                const CUSTOM_DEFAULTS: Record<string, { amount: number; unit: Unit }> = {
                                    booking: { amount: 0, unit: 'minutes' },
                                    check_in: { amount: 2, unit: 'days' },
                                    after_check_in: { amount: 2, unit: 'hours' },
                                    before_check_out: { amount: 12, unit: 'hours' },
                                    after_check_out: { amount: 1, unit: 'days' },
                                };
                                // Caps that keep a custom timing inside the windows the
                                // cron actually looks at, so nothing a host can set here
                                // silently never sends: booking-anchored within the
                                // 7-day confirmed-at sweep, stay-anchored within the
                                // ±40-day stay-dates sweep.
                                const maxFor = (a: string, u: Unit): number => {
                                    if (a === 'booking') return u === 'days' ? 6 : u === 'hours' ? 144 : 8640;
                                    if (a === 'check_in') return 30;
                                    return u === 'days' ? 14 : 336;
                                };
                                const setWhen = (a: string, amt: number, u: Unit, hour: number) =>
                                    setDraftSchedule(Object.assign({}, draftSchedule,
                                        scheduleColumns(a, Math.min(Math.max(0, amt || 0), maxFor(a, u)), u, hour)));
                                const selectCls = 'rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none';
                                return (
                                    <div className="space-y-4">
                                        <label className="block">
                                            <span className="block text-xs font-medium text-slate-500 mb-1">Trigger</span>
                                            <select
                                                value={anchor}
                                                onChange={(e) => {
                                                    const a = e.target.value;
                                                    const d = CUSTOM_DEFAULTS[a] || { amount: 1, unit: 'hours' as Unit };
                                                    setWhen(a, d.amount, d.unit, sendHour);
                                                }}
                                                className={`${selectCls} w-full`}
                                            >
                                                {CUSTOM_TRIGGERS.map((t) => (
                                                    <option key={t.anchor} value={t.anchor}>{t.label}</option>
                                                ))}
                                            </select>
                                        </label>

                                        <div className="flex items-end gap-2 flex-wrap">
                                            <label className="block">
                                                <span className="block text-xs font-medium text-slate-500 mb-1">How long</span>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={maxFor(anchor, au.unit)}
                                                    value={au.amount}
                                                    onChange={(e) => setWhen(anchor, Number(e.target.value), au.unit, sendHour)}
                                                    className={`${selectCls} w-24`}
                                                />
                                            </label>

                                            {trig.units.length > 1 ? (
                                                <select
                                                    value={au.unit}
                                                    onChange={(e) => setWhen(anchor, au.amount, e.target.value as Unit, sendHour)}
                                                    className={selectCls}
                                                >
                                                    {trig.units.map((u) => (
                                                        <option key={u} value={u}>{u}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <span className="px-1 py-2 text-sm text-slate-600">{trig.units[0]}</span>
                                            )}

                                            {trig.timeOfDay && (
                                                <label className="block">
                                                    <span className="block text-xs font-medium text-slate-500 mb-1">At</span>
                                                    <select
                                                        value={sendHour}
                                                        onChange={(e) => setWhen(anchor, au.amount, au.unit, Number(e.target.value))}
                                                        className={selectCls}
                                                    >
                                                        {HOURS.map((h) => (
                                                            <option key={h} value={h}>{h < 10 ? `0${h}:00` : `${h}:00`}</option>
                                                        ))}
                                                    </select>
                                                </label>
                                            )}
                                        </div>

                                        <p className="text-sm text-slate-600">
                                            Sends <span className="font-semibold">{describeSchedule(Object.assign({ anchor, minutes_after: 0, days_offset: 0, send_hour: sendHour, hours_after: 0, hours_before: 0 }, draftSchedule) as any).toLowerCase()}</span>.
                                        </p>
                                    </div>
                                );
                            })()
                        ) : (
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
                        )}

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
