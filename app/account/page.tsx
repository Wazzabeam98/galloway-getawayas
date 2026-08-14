'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { toast } from 'react-toastify';
import {
    User,
    Shield,
    Lock,
    Bell,
    CreditCard,
    MessageCircle,
    CalendarCheck,
    KeyRound,
    LogOut,
    Trash2,
    Smartphone,
    CheckCircle2,
    Download,
    Clock,
} from 'lucide-react';

const SECTIONS = [
    { key: 'personal', label: 'Personal information', icon: User, ready: true },
    { key: 'security', label: 'Login & security', icon: Lock, ready: true },
    { key: 'privacy', label: 'Privacy', icon: Shield, ready: true },
    { key: 'notifications', label: 'Notifications', icon: Bell, ready: false },
    { key: 'payments', label: 'Payments & payouts', icon: CreditCard, ready: false },
    { key: 'messaging', label: 'Messaging', icon: MessageCircle, ready: true },
    { key: 'bookings', label: 'Booking permissions', icon: CalendarCheck, ready: false },
];

// Turns a stored schedule into the sentence shown on the button.
function describeSchedule(t: { anchor: string; minutes_after: number; days_offset: number; send_hour: number }): string {
    const hh = (h: number) => (h < 10 ? `0${h}:00` : `${h}:00`);
    if (!t.anchor || t.anchor === 'none') return 'Not scheduled';
    if (t.anchor === 'booking') {
        if (!t.minutes_after) return 'As soon as you accept';
        if (t.minutes_after === 60) return '1 hour after booking confirmed';
        if (t.minutes_after % 60 === 0) return `${t.minutes_after / 60} hours after booking confirmed`;
        return `${t.minutes_after} minutes after booking confirmed`;
    }
    const when = t.anchor === 'check_in' ? 'check-in' : 'check-out';
    if (t.days_offset === 0) return `On the day of ${when} at ${hh(t.send_hour)}`;
    if (t.days_offset === 1) return `1 day before ${when} at ${hh(t.send_hour)}`;
    return `${t.days_offset} days before ${when} at ${hh(t.send_hour)}`;
}

interface Preset {
    label: string;
    values: { anchor: string; minutes_after: number; days_offset: number; send_hour: number };
}

const SCHEDULE_PRESETS: (Preset & { family: 'booking' | 'stay' | 'both' })[] = [
    { family: 'both',    label: "Don't schedule",                       values: { anchor: 'none',      minutes_after: 0,  days_offset: 0, send_hour: 9 } },

    { family: 'booking', label: 'As soon as you accept a booking',      values: { anchor: 'booking',   minutes_after: 0,  days_offset: 0, send_hour: 9 } },
    { family: 'booking', label: '5 minutes after booking confirmed',    values: { anchor: 'booking',   minutes_after: 5,  days_offset: 0, send_hour: 9 } },
    { family: 'booking', label: '30 minutes after booking confirmed',   values: { anchor: 'booking',   minutes_after: 30, days_offset: 0, send_hour: 9 } },
    { family: 'booking', label: '1 hour after booking confirmed',       values: { anchor: 'booking',   minutes_after: 60, days_offset: 0, send_hour: 9 } },

    { family: 'stay',    label: '3 days before check-in at 10:00',      values: { anchor: 'check_in',  minutes_after: 0,  days_offset: 3, send_hour: 10 } },
    { family: 'stay',    label: '1 day before check-in at 10:00',       values: { anchor: 'check_in',  minutes_after: 0,  days_offset: 1, send_hour: 10 } },
    { family: 'stay',    label: 'On the morning of check-in at 09:00',  values: { anchor: 'check_in',  minutes_after: 0,  days_offset: 0, send_hour: 9 } },
    { family: 'stay',    label: '1 day before check-out at 18:00',      values: { anchor: 'check_out', minutes_after: 0,  days_offset: 1, send_hour: 18 } },
    { family: 'stay',    label: 'On the morning of check-out at 09:00', values: { anchor: 'check_out', minutes_after: 0,  days_offset: 0, send_hour: 9 } },
];

const ANCHOR_LABELS: { key: string; label: string }[] = [
    { key: 'booking',   label: 'after you accept a booking' },
    { key: 'check_in',  label: 'before check-in' },
    { key: 'check_out', label: 'before check-out' },
];

interface Field {
    key: 'full_name' | 'preferred_name' | 'phone' | 'residential_address';
    label: string;
}

const FIELDS: Field[] = [
    { key: 'full_name', label: 'Legal name' },
    { key: 'preferred_name', label: 'Preferred name' },
    { key: 'phone', label: 'Phone number' },
];

const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

interface TemplateDef {
    key: string;
    label: string;
    hint: string;
    placeholder: string;
    defaultOffset: number;
    // Which kind of timing makes sense: hung off the booking being
    // accepted, or off the dates of the stay itself.
    family: 'booking' | 'stay';
    offsetLabel?: string;
    offsetChoices?: number[];
}

const TEMPLATE_TYPES: TemplateDef[] = [
    {
        key: 'booking_confirmation',
        family: 'booking',
        label: 'Booking confirmation',
        hint: 'Sent the moment you accept a booking request.',
        placeholder: "Hi {guest_name}, thanks for booking {listing}! I've confirmed your stay from {check_in} to {check_out}. Any questions before you arrive, just reply here.",
        defaultOffset: 0,
    },
    {
        key: 'checkin_details',
        family: 'stay',
        label: 'Check-in details',
        hint: 'The practical stuff — address, key safe, parking, wifi.',
        placeholder: "Hi {guest_name}, you're arriving at {listing} on {check_in}. Check-in is any time after 4pm. The key safe is to the right of the front door — code 1234. Parking is on the street directly outside.",
        defaultOffset: 3,
        offsetLabel: 'days before arrival',
        offsetChoices: [1, 2, 3, 4, 5, 6, 7, 10, 14],
    },
    {
        key: 'checkin_day',
        family: 'stay',
        label: 'Checking in with guest',
        hint: 'A friendly note on the morning of their arrival day.',
        placeholder: "Hi {guest_name}, hope the journey goes smoothly today. Everything's ready for you at {listing} — give me a shout if you need anything at all.",
        defaultOffset: 0,
    },
    {
        key: 'checkout_details',
        family: 'stay',
        label: 'Check-out details',
        hint: 'What you need them to do before they leave.',
        placeholder: "Hi {guest_name}, hope you've had a lovely stay. Check-out is by 10am on {check_out} — just pop the keys back in the safe and close the door behind you. Bins are round the side if you have any rubbish.",
        defaultOffset: 1,
        offsetLabel: 'days before departure',
        offsetChoices: [1, 2, 3],
    },
];

export default function AccountSettings() {
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [email, setEmail] = useState('');
    const [activeSection, setActiveSection] = useState('personal');

    const [profile, setProfile] = useState<{ full_name: string; preferred_name: string; phone: string; residential_address: string }>({
        full_name: '',
        preferred_name: '',
        phone: '',
        residential_address: '',
    });
    const [editingField, setEditingField] = useState<string | null>(null);
    const [draftValue, setDraftValue] = useState('');
    const [saving, setSaving] = useState(false);

    // Structured fields for the residential address form specifically
    const [addrCountry, setAddrCountry] = useState('United Kingdom');
    const [addrFlat, setAddrFlat] = useState('');
    const [addrPropertyName, setAddrPropertyName] = useState('');
    const [addrStreet, setAddrStreet] = useState('');
    const [addrLocality, setAddrLocality] = useState('');
    const [addrTown, setAddrTown] = useState('');
    const [addrPostcode, setAddrPostcode] = useState('');

    // --- Login & security state ---
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [changingPassword, setChangingPassword] = useState(false);
    const [signingOutAll, setSigningOutAll] = useState(false);
    const [linkedProviders, setLinkedProviders] = useState<string[]>([]);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [deleting, setDeleting] = useState(false);

    // --- Privacy state ---
    const [privacyTab, setPrivacyTab] = useState<'sharing' | 'data'>('sharing');
    const [showFullName, setShowFullName] = useState(true);
    const [savingPrivacy, setSavingPrivacy] = useState(false);
    const [exporting, setExporting] = useState(false);

    // --- Messaging state ---
    interface QuickReply { id: string; title: string; body: string }
    const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
    const [qrTitle, setQrTitle] = useState('');
    const [qrBody, setQrBody] = useState('');
    const [qrEditingId, setQrEditingId] = useState<string | null>(null);
    const [savingQr, setSavingQr] = useState(false);

    interface Template {
        template_type: string;
        body: string;
        enabled: boolean;
        days_offset: number;
        send_hour: number;
        anchor: string;
        minutes_after: number;
    }
    const [templates, setTemplates] = useState<Record<string, Template>>({});
    const [savingTemplate, setSavingTemplate] = useState<string | null>(null);
    const [scheduleFor, setScheduleFor] = useState<string | null>(null);
    const [draftSchedule, setDraftSchedule] = useState<Partial<Template>>({});

    const supabase = createClientComponentClient();
    const router = useRouter();

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (session?.user) {
                setEmail(session.user.email || '');

                // Which sign-in methods are attached to this account.
                // Supabase puts these on app_metadata; older accounts may only
                // have the singular 'provider' key, so check both.
                const meta: any = session.user.app_metadata || {};
                const providers: string[] = meta.providers || (meta.provider ? [meta.provider] : []);
                setLinkedProviders(providers);

                const { data: profileData } = await supabase
                    .from('profiles')
                    .select('full_name, preferred_name, phone, residential_address, show_full_name')
                    .eq('id', session.user.id)
                    .single();

                if (profileData) {
                    setProfile({
                        full_name: profileData.full_name || '',
                        preferred_name: profileData.preferred_name || '',
                        phone: profileData.phone || '',
                        residential_address: profileData.residential_address || '',
                    });
                    setShowFullName(profileData.show_full_name !== false);
                }

                const { data: tpls } = await supabase
                    .from('message_templates')
                    .select('template_type, body, enabled, days_offset, send_hour, anchor, minutes_after')
                    .eq('user_id', session.user.id);

                const tplMap: Record<string, Template> = {};
                (tpls || []).forEach((t) => { tplMap[t.template_type] = t; });
                setTemplates(tplMap);

                const { data: replies } = await supabase
                    .from('quick_replies')
                    .select('id, title, body')
                    .eq('user_id', session.user.id)
                    .order('created_at', { ascending: true });
                setQuickReplies(replies || []);
            }
            setLoading(false);
        };
        load();
    }, [supabase]);

    const startEdit = (field: Field) => {
        setEditingField(field.key);
        setDraftValue(profile[field.key] || '');
    };

    const saveField = async (field: Field) => {
        if (!session?.user) return;
        setSaving(true);

        // Upsert instead of update: if this account's profiles row was never
        // created (e.g. signup's insert got blocked before email confirmation),
        // this creates it instead of silently updating a row that doesn't exist.
        const { error } = await supabase
            .from('profiles')
            .upsert(
                {
                    id: session.user.id,
                    email: session.user.email,
                    [field.key]: draftValue,
                },
                { onConflict: 'id' }
            );

        setSaving(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        setProfile((prev) => ({ ...prev, [field.key]: draftValue }));
        setEditingField(null);
        router.refresh();
    };

    const saveAddress = async () => {
        if (!session?.user) return;
        setSaving(true);

        const combined = [addrFlat, addrPropertyName, addrStreet, addrLocality, addrTown, addrPostcode, addrCountry]
            .filter(Boolean)
            .join(', ');

        const { error } = await supabase
            .from('profiles')
            .upsert(
                { id: session.user.id, email: session.user.email, residential_address: combined },
                { onConflict: 'id' }
            );

        setSaving(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        setProfile((prev) => ({ ...prev, residential_address: combined }));
        setEditingField(null);
        router.refresh();
    };

    // --- Login & security handlers ---

    const changePassword = async () => {
        if (!session?.user?.email) return;

        if (newPassword.length < 8) {
            toast.error('Your new password needs to be at least 8 characters.', { theme: 'colored' });
            return;
        }
        if (newPassword !== confirmPassword) {
            toast.error("Those two passwords don't match.", { theme: 'colored' });
            return;
        }
        if (newPassword === currentPassword) {
            toast.error('Your new password needs to be different from your current one.', { theme: 'colored' });
            return;
        }

        setChangingPassword(true);

        // Supabase's updateUser does NOT ask for the existing password, so on its
        // own anyone at an unlocked laptop could change it. Re-signing in first
        // proves the person actually knows the current password.
        const { error: checkError } = await supabase.auth.signInWithPassword({
            email: session.user.email,
            password: currentPassword,
        });

        if (checkError) {
            setChangingPassword(false);
            toast.error('Your current password is not correct.', { theme: 'colored' });
            return;
        }

        const { error } = await supabase.auth.updateUser({ password: newPassword });
        setChangingPassword(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        toast.success('Password updated.', { theme: 'colored' });
    };

    const signOutEverywhere = async () => {
        setSigningOutAll(true);
        const { error } = await supabase.auth.signOut({ scope: 'global' });
        setSigningOutAll(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        toast.success('Signed out on all devices.', { theme: 'colored' });
        router.push('/');
        router.refresh();
    };

    const deleteAccount = async () => {
        if (deleteConfirmText !== 'DELETE') return;
        setDeleting(true);

        // Runs a database function that refuses if there are still live
        // bookings, then removes the account. See the Supabase SQL step.
        const { error } = await supabase.rpc('delete_own_account');

        if (error) {
            setDeleting(false);
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        await supabase.auth.signOut();
        router.push('/');
        router.refresh();
    };

    // --- Privacy handlers ---

    const toggleShowFullName = async (next: boolean) => {
        if (!session?.user) return;
        setSavingPrivacy(true);
        setShowFullName(next);

        const { error } = await supabase
            .from('profiles')
            .upsert(
                { id: session.user.id, email: session.user.email, show_full_name: next },
                { onConflict: 'id' }
            );

        setSavingPrivacy(false);

        if (error) {
            setShowFullName(!next);
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        toast.success('Privacy setting saved.', { theme: 'colored' });
    };

    const downloadMyData = async () => {
        if (!session?.user) return;
        setExporting(true);

        try {
            const uid = session.user.id;

            const profileRes = await supabase.from('profiles').select('*').eq('id', uid).single();
            const listingsRes = await supabase.from('listings').select('*').eq('host_id', uid);
            const guestBookingsRes = await supabase.from('bookings').select('*').eq('guest_id', uid);
            const hostBookingsRes = await supabase.from('bookings').select('*').eq('host_id', uid);
            const reviewsWrittenRes = await supabase.from('reviews').select('*').eq('reviewer_id', uid);
            const reviewsAboutRes = await supabase.from('reviews').select('*').eq('reviewee_id', uid);
            const messagesSentRes = await supabase.from('messages').select('*').eq('sender_id', uid);

            const output = {
                exported_at: new Date().toISOString(),
                exported_from: 'Galloway Getaways',
                account: {
                    id: uid,
                    email: session.user.email,
                    created_at: session.user.created_at,
                    last_sign_in_at: session.user.last_sign_in_at,
                },
                profile: profileRes.data || null,
                listings: listingsRes.data || [],
                bookings_as_guest: guestBookingsRes.data || [],
                bookings_as_host: hostBookingsRes.data || [],
                reviews_you_wrote: reviewsWrittenRes.data || [],
                reviews_about_you: reviewsAboutRes.data || [],
                messages_you_sent: messagesSentRes.data || [],
            };

            const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'galloway-getaways-my-data.json';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            toast.success('Your data has been downloaded.', { theme: 'colored' });
        } catch (err: any) {
            toast.error('Could not build your data file. Please try again.', { theme: 'colored' });
        }

        setExporting(false);
    };

    // --- Messaging handlers ---

    const saveQuickReply = async () => {
        if (!session?.user || !qrTitle.trim() || !qrBody.trim()) return;
        setSavingQr(true);

        if (qrEditingId) {
            const { error } = await supabase
                .from('quick_replies')
                .update({ title: qrTitle.trim(), body: qrBody.trim() })
                .eq('id', qrEditingId);

            setSavingQr(false);
            if (error) {
                toast.error(error.message, { theme: 'colored' });
                return;
            }

            setQuickReplies((prev) =>
                prev.map((r) => (r.id === qrEditingId ? { id: r.id, title: qrTitle.trim(), body: qrBody.trim() } : r))
            );
        } else {
            const { data, error } = await supabase
                .from('quick_replies')
                .insert({ user_id: session.user.id, title: qrTitle.trim(), body: qrBody.trim() })
                .select('id, title, body')
                .single();

            setSavingQr(false);
            if (error) {
                toast.error(error.message, { theme: 'colored' });
                return;
            }
            if (data) setQuickReplies((prev) => prev.concat([data]));
        }

        setQrTitle('');
        setQrBody('');
        setQrEditingId(null);
        toast.success('Quick reply saved.', { theme: 'colored' });
    };

    const editQuickReply = (reply: QuickReply) => {
        setQrEditingId(reply.id);
        setQrTitle(reply.title);
        setQrBody(reply.body);
    };

    const deleteQuickReply = async (id: string) => {
        const { error } = await supabase.from('quick_replies').delete().eq('id', id);
        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }
        setQuickReplies((prev) => prev.filter((r) => r.id !== id));
        if (qrEditingId === id) {
            setQrEditingId(null);
            setQrTitle('');
            setQrBody('');
        }
    };

    const getTemplate = (type: string, defaultOffset: number): Template => {
        return templates[type] || {
            template_type: type,
            body: '',
            enabled: false,
            days_offset: defaultOffset,
            send_hour: 9,
            anchor: 'none',
            minutes_after: 0,
        };
    };

    const patchTemplate = (type: string, patch: Partial<Template>, defaultOffset: number) => {
        const current = getTemplate(type, defaultOffset);
        const next = Object.assign({}, current, patch);
        setTemplates((prev) => Object.assign({}, prev, { [type]: next }));
        return next;
    };

    const saveTemplate = async (type: string, defaultOffset: number, patch?: Partial<Template>) => {
        if (!session?.user) return;
        const next = patch ? patchTemplate(type, patch, defaultOffset) : getTemplate(type, defaultOffset);

        setSavingTemplate(type);
        const { error } = await supabase
            .from('message_templates')
            .upsert(
                {
                    user_id: session.user.id,
                    template_type: type,
                    body: next.body,
                    enabled: next.enabled,
                    days_offset: next.days_offset,
                    send_hour: next.send_hour,
                    anchor: next.anchor,
                    minutes_after: next.minutes_after,
                },
                { onConflict: 'user_id,template_type' }
            );
        setSavingTemplate(null);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }
        toast.success('Saved.', { theme: 'colored' });
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4">
                <Logo />
                <p className="text-slate-500 animate-pulse">Loading your account...</p>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-6 text-center px-4">
                <Logo />
                <h1 className="text-2xl font-bold text-slate-900">Sign in to view your account</h1>
                <LoginModel />
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto px-6 py-10 w-full">
            <h1 className="text-3xl font-extrabold text-slate-900 mb-8">Account settings</h1>

            <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-10">
                {/* Sidebar */}
                <div className="space-y-1">
                    {SECTIONS.map(({ key, label, icon: Icon }) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setActiveSection(key)}
                            className={`w-full flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition ${activeSection === key ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                            <Icon className="w-4 h-4 mr-3" /> {label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div>
                    {activeSection === 'personal' ? (
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">Personal information</h2>
                            <div className="border rounded-2xl divide-y">
                                {FIELDS.map((field) => (
                                    <div key={field.key} className="p-5 flex items-center justify-between">
                                        <div className="flex-1">
                                            <div className="font-semibold text-slate-900 text-sm mb-1">{field.label}</div>
                                            {editingField === field.key ? (
                                                <input
                                                    type="text"
                                                    value={draftValue}
                                                    onChange={(e) => setDraftValue(e.target.value)}
                                                    autoFocus
                                                    className="w-full max-w-sm p-2 border rounded-lg text-sm"
                                                />
                                            ) : (
                                                <div className="text-slate-500 text-sm whitespace-pre-line">
                                                    {profile[field.key] || 'Not provided'}
                                                </div>
                                            )}
                                        </div>
                                        {editingField === field.key ? (
                                            <div className="flex items-center space-x-3 ml-4">
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingField(null)}
                                                    className="text-sm text-slate-500 hover:text-slate-800"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => saveField(field)}
                                                    disabled={saving}
                                                    className="text-sm font-semibold text-white bg-slate-900 hover:bg-black px-4 py-1.5 rounded-lg disabled:opacity-60"
                                                >
                                                    {saving ? 'Saving...' : 'Save'}
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => startEdit(field)}
                                                className="text-sm font-semibold underline text-slate-700 hover:text-black ml-4 flex-shrink-0"
                                            >
                                                Edit
                                            </button>
                                        )}
                                    </div>
                                ))}

                                {/* Residential address — its own structured form, matching Airbnb's layout */}
                                <div className="p-5">
                                    {editingField === 'residential_address' ? (
                                        <div>
                                            <div className="flex items-center justify-between mb-4">
                                                <div className="font-semibold text-slate-900 text-sm">Residential address</div>
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingField(null)}
                                                    className="text-sm font-semibold underline text-slate-700 hover:text-black"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                            <div className="space-y-3 max-w-sm">
                                                <div>
                                                    <label className="text-xs text-slate-500">Country/region</label>
                                                    <input
                                                        type="text"
                                                        value={addrCountry}
                                                        onChange={(e) => setAddrCountry(e.target.value)}
                                                        className="w-full p-2.5 border rounded-lg text-sm mt-1"
                                                    />
                                                </div>
                                                <input
                                                    type="text"
                                                    placeholder="Flat, floor, bldg (if applicable)"
                                                    value={addrFlat}
                                                    onChange={(e) => setAddrFlat(e.target.value)}
                                                    className="w-full p-2.5 border rounded-lg text-sm"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Property name (if applicable)"
                                                    value={addrPropertyName}
                                                    onChange={(e) => setAddrPropertyName(e.target.value)}
                                                    className="w-full p-2.5 border rounded-lg text-sm"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Street address"
                                                    value={addrStreet}
                                                    onChange={(e) => setAddrStreet(e.target.value)}
                                                    className="w-full p-2.5 border rounded-lg text-sm"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Locality (if applicable)"
                                                    value={addrLocality}
                                                    onChange={(e) => setAddrLocality(e.target.value)}
                                                    className="w-full p-2.5 border rounded-lg text-sm"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Town"
                                                    value={addrTown}
                                                    onChange={(e) => setAddrTown(e.target.value)}
                                                    className="w-full p-2.5 border rounded-lg text-sm"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Postcode"
                                                    value={addrPostcode}
                                                    onChange={(e) => setAddrPostcode(e.target.value)}
                                                    className="w-full p-2.5 border rounded-lg text-sm"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={saveAddress}
                                                    disabled={saving || !addrStreet || !addrTown}
                                                    className="w-full py-2.5 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                                >
                                                    {saving ? 'Saving...' : 'Save'}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="font-semibold text-slate-900 text-sm mb-1">Residential address</div>
                                                <div className="text-slate-500 text-sm whitespace-pre-line">
                                                    {profile.residential_address || 'Not provided'}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingField('residential_address');
                                                    setAddrCountry('United Kingdom');
                                                    setAddrFlat('');
                                                    setAddrPropertyName('');
                                                    setAddrStreet('');
                                                    setAddrLocality('');
                                                    setAddrTown('');
                                                    setAddrPostcode('');
                                                }}
                                                className="text-sm font-semibold underline text-slate-700 hover:text-black ml-4 flex-shrink-0"
                                            >
                                                Edit
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="p-5 flex items-center justify-between">
                                    <div>
                                        <div className="font-semibold text-slate-900 text-sm mb-1">Email address</div>
                                        <div className="text-slate-500 text-sm">{email}</div>
                                    </div>
                                    <span className="text-xs text-slate-400 ml-4">Contact support to change</span>
                                </div>

                                <div className="p-5">
                                    <div className="font-semibold text-slate-900 text-sm mb-1">Identity verification</div>
                                    <div className="flex items-center text-sm text-amber-600 font-medium mb-1">
                                        <span className="w-2 h-2 rounded-full bg-amber-500 mr-2" /> Not verified
                                    </div>
                                    <p className="text-xs text-slate-400">
                                        Real ID verification isn't set up yet — this needs a proper verification provider, not just a self-reported status.
                                    </p>
                                </div>
                            </div>
                        </div>
                    ) : activeSection === 'security' ? (
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-6">Login &amp; security</h2>

                            {/* Change password */}
                            <div className="border rounded-2xl p-5 mb-6">
                                <div className="flex items-center mb-1">
                                    <KeyRound className="w-4 h-4 mr-2 text-slate-700" />
                                    <div className="font-semibold text-slate-900 text-sm">Password</div>
                                </div>
                                <p className="text-xs text-slate-400 mb-4">
                                    Use at least 8 characters. You&apos;ll need your current password to make a change.
                                </p>

                                <div className="space-y-3 max-w-sm">
                                    <div>
                                        <label className="text-xs text-slate-500">Current password</label>
                                        <input
                                            type="password"
                                            value={currentPassword}
                                            onChange={(e) => setCurrentPassword(e.target.value)}
                                            autoComplete="current-password"
                                            className="w-full p-2.5 border rounded-lg text-sm mt-1"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-500">New password</label>
                                        <input
                                            type="password"
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            autoComplete="new-password"
                                            className="w-full p-2.5 border rounded-lg text-sm mt-1"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-500">Confirm new password</label>
                                        <input
                                            type="password"
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            autoComplete="new-password"
                                            className="w-full p-2.5 border rounded-lg text-sm mt-1"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={changePassword}
                                        disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                                        className="w-full py-2.5 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {changingPassword ? 'Updating...' : 'Update password'}
                                    </button>
                                </div>
                            </div>

                            {/* Devices */}
                            <div className="border rounded-2xl p-5 mb-6 flex items-start justify-between">
                                <div className="pr-4">
                                    <div className="flex items-center mb-1">
                                        <LogOut className="w-4 h-4 mr-2 text-slate-700" />
                                        <div className="font-semibold text-slate-900 text-sm">Signed-in devices</div>
                                    </div>
                                    <p className="text-xs text-slate-400">
                                        Signs you out everywhere, including this device. Worth doing if you&apos;ve used a shared or public computer.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={signOutEverywhere}
                                    disabled={signingOutAll}
                                    className="text-sm font-semibold underline text-slate-700 hover:text-black flex-shrink-0 disabled:opacity-40"
                                >
                                    {signingOutAll ? 'Signing out...' : 'Sign out everywhere'}
                                </button>
                            </div>

                            {/* Social logins */}
                            <div className="border rounded-2xl divide-y mb-6">
                                <div className="p-5">
                                    <div className="font-semibold text-slate-900 text-sm mb-1">Connected accounts</div>
                                    <p className="text-xs text-slate-400">Other ways you can sign in to Galloway Getaways.</p>
                                </div>

                                <div className="p-5 flex items-center justify-between">
                                    <div className="text-sm text-slate-700">Email and password</div>
                                    <span className="flex items-center text-xs font-medium text-emerald-700">
                                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Active
                                    </span>
                                </div>

                                <div className="p-5 flex items-center justify-between">
                                    <div className="text-sm text-slate-700">Google</div>
                                    {linkedProviders.indexOf('google') !== -1 ? (
                                        <span className="flex items-center text-xs font-medium text-emerald-700">
                                            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Connected
                                        </span>
                                    ) : (
                                        <span className="text-xs text-slate-400">Not connected</span>
                                    )}
                                </div>

                                <div className="p-5 flex items-center justify-between">
                                    <div className="text-sm text-slate-700">Facebook</div>
                                    {linkedProviders.indexOf('facebook') !== -1 ? (
                                        <span className="flex items-center text-xs font-medium text-emerald-700">
                                            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Connected
                                        </span>
                                    ) : (
                                        <span className="text-xs text-slate-400">Not connected</span>
                                    )}
                                </div>
                            </div>

                            {/* 2FA placeholder */}
                            <div className="border rounded-2xl p-5 mb-6">
                                <div className="flex items-center mb-1">
                                    <Smartphone className="w-4 h-4 mr-2 text-slate-700" />
                                    <div className="font-semibold text-slate-900 text-sm">Two-factor authentication</div>
                                </div>
                                <div className="flex items-center text-sm text-amber-600 font-medium mb-1">
                                    <span className="w-2 h-2 rounded-full bg-amber-500 mr-2" /> Not set up
                                </div>
                                <p className="text-xs text-slate-400">
                                    Two-factor sign-in isn&apos;t available yet. It needs an authenticator app and recovery codes to be done properly.
                                </p>
                            </div>

                            {/* Delete account */}
                            <div className="border border-red-200 bg-red-50/40 rounded-2xl p-5">
                                <div className="flex items-center mb-1">
                                    <Trash2 className="w-4 h-4 mr-2 text-red-700" />
                                    <div className="font-semibold text-red-800 text-sm">Delete my account</div>
                                </div>
                                <p className="text-xs text-red-700/80 mb-4">
                                    This permanently removes your account, your profile, your listings and your booking history. It cannot be undone. If you have upcoming or pending bookings, cancel them first — as either a guest or a host.
                                </p>

                                {!deleteOpen ? (
                                    <button
                                        type="button"
                                        onClick={() => setDeleteOpen(true)}
                                        className="text-sm font-semibold text-red-700 underline hover:text-red-900"
                                    >
                                        I want to delete my account
                                    </button>
                                ) : (
                                    <div className="max-w-sm">
                                        <label className="text-xs text-red-800 font-medium">
                                            Type DELETE to confirm
                                        </label>
                                        <input
                                            type="text"
                                            value={deleteConfirmText}
                                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                                            placeholder="DELETE"
                                            className="w-full p-2.5 border border-red-300 rounded-lg text-sm mt-1 mb-3 bg-white"
                                        />
                                        <div className="flex items-center space-x-3">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setDeleteOpen(false);
                                                    setDeleteConfirmText('');
                                                }}
                                                className="text-sm text-slate-600 hover:text-slate-900"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                onClick={deleteAccount}
                                                disabled={deleting || deleteConfirmText !== 'DELETE'}
                                                className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                {deleting ? 'Deleting...' : 'Permanently delete'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : activeSection === 'privacy' ? (
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-1">Privacy &amp; sharing</h2>
                            <p className="text-sm text-slate-500 mb-6">
                                Control what other people see, and manage the information we hold about you.
                            </p>

                            <div className="flex border-b mb-6">
                                <button
                                    type="button"
                                    onClick={() => setPrivacyTab('sharing')}
                                    className={`px-1 pb-3 mr-6 text-sm font-semibold border-b-2 -mb-px transition ${privacyTab === 'sharing' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                                >
                                    Sharing
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPrivacyTab('data')}
                                    className={`px-1 pb-3 text-sm font-semibold border-b-2 -mb-px transition ${privacyTab === 'data' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                                >
                                    Data
                                </button>
                            </div>

                            {privacyTab === 'sharing' ? (
                                <div className="border rounded-2xl divide-y">
                                    <div className="p-5 flex items-start justify-between">
                                        <div className="pr-6">
                                            <div className="font-semibold text-slate-900 text-sm mb-1">
                                                Show my full legal name
                                            </div>
                                            <p className="text-xs text-slate-500">
                                                When this is on, hosts and guests you book with see your legal name. Turn it off
                                                and they&apos;ll only ever see your preferred name
                                                {profile.preferred_name ? ` (${profile.preferred_name})` : ''}.
                                            </p>
                                            {!showFullName && !profile.preferred_name && (
                                                <p className="text-xs text-amber-600 mt-2">
                                                    You haven&apos;t set a preferred name, so other people will just see
                                                    &quot;Host&quot; or &quot;Guest&quot; instead of a name. Add one under
                                                    Personal information.
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={showFullName}
                                            aria-label="Show my full legal name"
                                            disabled={savingPrivacy}
                                            onClick={() => toggleShowFullName(!showFullName)}
                                            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${showFullName ? 'bg-emerald-700' : 'bg-slate-300'}`}
                                        >
                                            <span
                                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${showFullName ? 'translate-x-5' : 'translate-x-0.5'}`}
                                            />
                                        </button>
                                    </div>

                                    <div className="p-5">
                                        <div className="font-semibold text-slate-900 text-sm mb-1">
                                            Public profile page
                                        </div>
                                        <div className="flex items-center text-sm text-slate-500 font-medium mb-1">
                                            <span className="w-2 h-2 rounded-full bg-slate-300 mr-2" /> Not applicable yet
                                        </div>
                                        <p className="text-xs text-slate-400">
                                            Galloway Getaways doesn&apos;t have public profile pages, so nothing about you appears
                                            in search engines. If that changes, a setting to control it will appear here.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <div className="border rounded-2xl p-5 mb-6">
                                        <div className="flex items-center mb-1">
                                            <Download className="w-4 h-4 mr-2 text-slate-700" />
                                            <div className="font-semibold text-slate-900 text-sm">Download your data</div>
                                        </div>
                                        <p className="text-xs text-slate-500 mb-4">
                                            Get a copy of everything we hold about you — your profile, listings, bookings,
                                            reviews and messages. The file downloads straight to this device. You have the
                                            right to request this under UK data protection law.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={downloadMyData}
                                            disabled={exporting}
                                            className="px-4 py-2.5 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-40"
                                        >
                                            {exporting ? 'Preparing your file...' : 'Download my data'}
                                        </button>
                                    </div>

                                    <div className="border rounded-2xl p-5">
                                        <div className="flex items-center mb-1">
                                            <Trash2 className="w-4 h-4 mr-2 text-slate-700" />
                                            <div className="font-semibold text-slate-900 text-sm">Delete your account</div>
                                        </div>
                                        <p className="text-xs text-slate-500 mb-4">
                                            Permanently remove your account and everything attached to it. This can&apos;t be undone.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => setActiveSection('security')}
                                            className="text-sm font-semibold underline text-slate-700 hover:text-black"
                                        >
                                            Go to Login &amp; security to delete
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : activeSection === 'messaging' ? (
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-1">Messaging</h2>
                            <p className="text-sm text-slate-500 mb-6">
                                Write your messages once and let them send themselves.
                            </p>

                            {/* Scheduled messages */}
                            <div className="mb-8">
                                <h3 className="text-base font-bold text-slate-900 mb-1">Scheduled messages</h3>
                                <p className="text-xs text-slate-500 mb-4">
                                    Written once, sent automatically at the right moment. Use{' '}
                                    <code className="bg-slate-100 px-1 rounded">{'{guest_name}'}</code>,{' '}
                                    <code className="bg-slate-100 px-1 rounded">{'{listing}'}</code>,{' '}
                                    <code className="bg-slate-100 px-1 rounded">{'{check_in}'}</code> or{' '}
                                    <code className="bg-slate-100 px-1 rounded">{'{check_out}'}</code> and they&apos;ll be
                                    filled in for each guest.
                                </p>

                                <div className="space-y-4">
                                    {TEMPLATE_TYPES.map((def) => {
                                        const tpl = getTemplate(def.key, def.defaultOffset);
                                        const busy = savingTemplate === def.key;

                                        return (
                                            <div key={def.key} className="border rounded-2xl p-5">
                                                <div className="flex items-start justify-between mb-3">
                                                    <div className="pr-6">
                                                        <div className="font-semibold text-slate-900 text-sm mb-1">
                                                            {def.label}
                                                        </div>
                                                        <p className="text-xs text-slate-500">{def.hint}</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        role="switch"
                                                        aria-checked={tpl.enabled}
                                                        aria-label={def.label}
                                                        disabled={busy}
                                                        onClick={() => saveTemplate(def.key, def.defaultOffset, { enabled: !tpl.enabled })}
                                                        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${tpl.enabled ? 'bg-emerald-700' : 'bg-slate-300'}`}
                                                    >
                                                        <span
                                                            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${tpl.enabled ? 'translate-x-5' : 'translate-x-0.5'}`}
                                                        />
                                                    </button>
                                                </div>

                                                <textarea
                                                    value={tpl.body}
                                                    onChange={(e) => patchTemplate(def.key, { body: e.target.value }, def.defaultOffset)}
                                                    rows={4}
                                                    placeholder={def.placeholder}
                                                    className="w-full p-3 border rounded-lg text-sm"
                                                />

                                                <div className="flex flex-wrap items-center gap-3 mt-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setScheduleFor(def.key);
                                                            setDraftSchedule({
                                                                anchor: tpl.anchor,
                                                                minutes_after: tpl.minutes_after,
                                                                days_offset: tpl.days_offset,
                                                                send_hour: tpl.send_hour,
                                                            });
                                                        }}
                                                        className="flex items-center gap-2 text-xs font-semibold text-slate-700 border rounded-lg px-3 py-2 hover:bg-slate-50"
                                                    >
                                                        <Clock className="w-3.5 h-3.5" />
                                                        {describeSchedule(tpl)}
                                                    </button>

                                                    <button
                                                        type="button"
                                                        onClick={() => saveTemplate(def.key, def.defaultOffset)}
                                                        disabled={busy}
                                                        className="ml-auto px-4 py-2 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-40"
                                                    >
                                                        {busy ? 'Saving...' : 'Save'}
                                                    </button>
                                                </div>

                                                {tpl.enabled && !tpl.body.trim() && (
                                                    <p className="text-xs text-amber-600 mt-3">
                                                        This is switched on but has no message written, so nothing will be sent.
                                                    </p>
                                                )}
                                                {tpl.enabled && tpl.body.trim() && tpl.anchor === 'none' && (
                                                    <p className="text-xs text-amber-600 mt-3">
                                                        This is switched on but isn&apos;t scheduled, so nothing will be sent. Pick a time above.
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Quick replies */}
                            <div className="border rounded-2xl p-5">
                                <div className="font-semibold text-slate-900 text-sm mb-1">Quick replies</div>
                                <p className="text-xs text-slate-500 mb-4">
                                    Snippets you can drop into any conversation with one tap — parking, wifi, check-in
                                    times, and anything else you find yourself typing repeatedly.
                                </p>

                                {quickReplies.length > 0 && (
                                    <div className="border rounded-xl divide-y mb-5">
                                        {quickReplies.map((reply) => (
                                            <div key={reply.id} className="p-4 flex items-start justify-between">
                                                <div className="pr-4 min-w-0">
                                                    <div className="font-semibold text-slate-900 text-sm">{reply.title}</div>
                                                    <p className="text-xs text-slate-500 mt-1 whitespace-pre-line">{reply.body}</p>
                                                </div>
                                                <div className="flex items-center space-x-3 flex-shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => editQuickReply(reply)}
                                                        className="text-sm font-semibold underline text-slate-700 hover:text-black"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => deleteQuickReply(reply.id)}
                                                        className="text-slate-400 hover:text-red-600"
                                                        aria-label={`Delete ${reply.title}`}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="space-y-3 max-w-lg">
                                    <div>
                                        <label className="text-xs text-slate-500">Shortcut name</label>
                                        <input
                                            type="text"
                                            value={qrTitle}
                                            onChange={(e) => setQrTitle(e.target.value)}
                                            placeholder="Wifi details"
                                            className="w-full p-2.5 border rounded-lg text-sm mt-1"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-500">Message</label>
                                        <textarea
                                            value={qrBody}
                                            onChange={(e) => setQrBody(e.target.value)}
                                            rows={3}
                                            placeholder="The wifi network is GallowayCottage and the password is on the fridge door."
                                            className="w-full p-2.5 border rounded-lg text-sm mt-1"
                                        />
                                    </div>
                                    <div className="flex items-center space-x-3">
                                        <button
                                            type="button"
                                            onClick={saveQuickReply}
                                            disabled={savingQr || !qrTitle.trim() || !qrBody.trim()}
                                            className="px-4 py-2.5 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {savingQr ? 'Saving...' : qrEditingId ? 'Update quick reply' : 'Add quick reply'}
                                        </button>
                                        {qrEditingId && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setQrEditingId(null);
                                                    setQrTitle('');
                                                    setQrBody('');
                                                }}
                                                className="text-sm text-slate-500 hover:text-slate-900"
                                            >
                                                Cancel
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="border rounded-2xl p-10 text-center">
                            <h2 className="text-xl font-bold text-slate-900 mb-2">
                                {SECTIONS.find((s) => s.key === activeSection)?.label}
                            </h2>
                            <p className="text-slate-500 text-sm">Coming soon — this section isn't built yet.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Schedule picker */}
            {scheduleFor && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto p-6">
                        <div className="flex items-start justify-between mb-1">
                            <h3 className="text-xl font-bold text-slate-900">Schedule message</h3>
                            <button
                                type="button"
                                onClick={() => setScheduleFor(null)}
                                aria-label="Close"
                                className="text-slate-400 hover:text-slate-800 text-xl leading-none"
                            >
                                &times;
                            </button>
                        </div>
                        <p className="text-sm text-slate-500 mb-5">
                            Times are UK local, and adjust automatically for British Summer Time.
                        </p>

                        <div className="space-y-2">
                            {SCHEDULE_PRESETS.filter((preset) => {
                                const def = TEMPLATE_TYPES.filter((d) => d.key === scheduleFor)[0];
                                if (!def) return true;
                                return preset.family === 'both' || preset.family === def.family;
                            }).map((preset) => {
                                const selected =
                                    draftSchedule.anchor === preset.values.anchor &&
                                    (draftSchedule.minutes_after || 0) === preset.values.minutes_after &&
                                    (draftSchedule.days_offset || 0) === preset.values.days_offset &&
                                    (draftSchedule.send_hour || 0) === preset.values.send_hour;

                                return (
                                    <button
                                        key={preset.label}
                                        type="button"
                                        onClick={() => setDraftSchedule(preset.values)}
                                        className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm transition ${selected ? 'border-slate-900 border-2 font-semibold text-slate-900' : 'border-slate-200 text-slate-700 hover:border-slate-400'}`}
                                    >
                                        {preset.label}
                                    </button>
                                );
                            })}

                            {/* Custom */}
                            <div className="rounded-xl border border-slate-200 p-4">
                                <div className="text-sm font-semibold text-slate-900 mb-3">Custom time</div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {(TEMPLATE_TYPES.filter((d) => d.key === scheduleFor)[0]?.family === 'booking') ? (
                                        <>
                                            <input
                                                type="number"
                                                min={0}
                                                max={1440}
                                                value={draftSchedule.minutes_after || 0}
                                                onChange={(e) => setDraftSchedule(Object.assign({}, draftSchedule, { anchor: 'booking', minutes_after: parseInt(e.target.value, 10) || 0 }))}
                                                className="w-20 border rounded-lg p-2 text-sm"
                                            />
                                            <span className="text-sm text-slate-600">minutes after booking confirmed</span>
                                        </>
                                    ) : (
                                        <>
                                            <input
                                                type="number"
                                                min={0}
                                                max={30}
                                                value={draftSchedule.days_offset || 0}
                                                onChange={(e) => setDraftSchedule(Object.assign({}, draftSchedule, { anchor: (!draftSchedule.anchor || draftSchedule.anchor === 'none') ? 'check_in' : draftSchedule.anchor, days_offset: parseInt(e.target.value, 10) || 0 }))}
                                                className="w-20 border rounded-lg p-2 text-sm"
                                            />
                                            <span className="text-sm text-slate-600">days</span>
                                        </>
                                    )}

                                    {(TEMPLATE_TYPES.filter((d) => d.key === scheduleFor)[0]?.family !== 'booking') && (
                                        <select
                                            value={draftSchedule.anchor === 'none' || draftSchedule.anchor === 'booking' ? 'check_in' : draftSchedule.anchor}
                                            onChange={(e) => setDraftSchedule(Object.assign({}, draftSchedule, { anchor: e.target.value }))}
                                            className="border rounded-lg p-2 text-sm flex-1 min-w-[180px]"
                                        >
                                            {ANCHOR_LABELS.filter((a) => a.key !== 'booking').map((a) => (
                                                <option key={a.key} value={a.key}>{a.label}</option>
                                            ))}
                                        </select>
                                    )}

                                    {(TEMPLATE_TYPES.filter((d) => d.key === scheduleFor)[0]?.family !== 'booking') && (
                                        <label className="flex items-center gap-2 text-sm text-slate-600">
                                            at
                                            <select
                                                value={draftSchedule.send_hour || 9}
                                                onChange={(e) => setDraftSchedule(Object.assign({}, draftSchedule, { send_hour: parseInt(e.target.value, 10) }))}
                                                className="border rounded-lg p-2 text-sm"
                                            >
                                                {HOURS.map((h) => (
                                                    <option key={h} value={h}>{h < 10 ? `0${h}:00` : `${h}:00`}</option>
                                                ))}
                                            </select>
                                        </label>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between mt-6">
                            <button
                                type="button"
                                onClick={() => setScheduleFor(null)}
                                className="text-sm font-semibold underline text-slate-700 hover:text-black"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const key = scheduleFor;
                                    const def = TEMPLATE_TYPES.filter((d) => d.key === key)[0];
                                    if (key && def) {
                                        saveTemplate(key, def.defaultOffset, draftSchedule);
                                    }
                                    setScheduleFor(null);
                                }}
                                className="px-6 py-2.5 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg"
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
