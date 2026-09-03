// WHERE THIS GOES: GitHub -> app/account/page.tsx  (REPLACE the whole file)
// Changed: Notifications marked ready, new import, new render branch.
// Everything else is byte-for-byte what you already had.

'use client';

import React, { useEffect, useState, useRef } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Logo from '@/components/base/Logo';
import MessageTemplates from '@/components/account/MessageTemplates';
import LoginModel from '@/components/auth/LoginModel';
import { toast } from 'react-toastify';
import { getImageUrl, formatTime } from '@/lib/utils';
import Env from '@/config/Env';
import { compressImage } from '@/lib/compressImage';
import NotificationsSection from '@/components/account/NotificationsSection';
import PaymentsSection from '@/components/account/PaymentsSection';
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
    { key: 'notifications', label: 'Notifications', icon: Bell, ready: true },
    { key: 'payments', label: 'Payments & payouts', icon: CreditCard, ready: true },
    { key: 'messaging', label: 'Messaging', icon: MessageCircle, ready: true },
    { key: 'bookings', label: 'Booking permissions', icon: CalendarCheck, ready: true },
];

// Flags anything that would leave a listing advertised unlawfully.
// Deliberately worded as a prompt, not legal advice.
function licenceWarning(l: {
    stl_licence_status: string | null;
    stl_licence_number: string | null;
    stl_licence_expiry: string | null;
}): string | null {
    const status = l.stl_licence_status || 'none';
    const number = (l.stl_licence_number || '').trim();

    if (status === 'none') {
        return 'No licence details yet. Short-term lets in Scotland need a licence, and the number has to appear on the listing.';
    }
    if (status === 'licensed' && !number) {
        return 'Add your licence number — it has to be shown on the listing.';
    }
    if (status === 'licensed' && !/^[A-Z]{3}[0-9]{5}$/.test(number)) {
        return 'Scottish licence numbers are usually three letters followed by five digits, like ABC12345. Worth double-checking this one.';
    }
    if (l.stl_licence_expiry) {
        const days = Math.round(
            (new Date(l.stl_licence_expiry).getTime() - Date.now()) / 86400000
        );
        if (days < 0) return 'This licence has expired. Renew it before taking further bookings.';
        if (days < 60) return `This licence expires in ${days} days. Renewals can take a while — worth starting now.`;
    }
    return null;
}

// "4 selected", or "All listings" when nothing specific is chosen.
function describeListings(ids: string[] | null | undefined): string {
    if (!ids || ids.length === 0) return 'All listings';
    return `${ids.length} selected`;
}

// Highlights the placeholders inside the box you actually type in.
//
interface Field {
    key: 'full_name' | 'preferred_name' | 'phone' | 'residential_address';
    label: string;
}

const FIELDS: Field[] = [
    { key: 'full_name', label: 'Legal name' },
    { key: 'preferred_name', label: 'Preferred name' },
    { key: 'phone', label: 'Phone number' },
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
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);

    // --- Host bio: the line about them shown on their listings ---
    const [hostBio, setHostBio] = useState('');
    const [savedBio, setSavedBio] = useState('');
    const [savingBio, setSavingBio] = useState(false);

    // --- Messaging state ---
    interface QuickReply { id: string; title: string; body: string }
    const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
    const [qrTitle, setQrTitle] = useState('');
    const [qrBody, setQrBody] = useState('');
    const [qrEditingId, setQrEditingId] = useState<string | null>(null);
    const [savingQr, setSavingQr] = useState(false);

    // --- Booking permissions state ---
    interface HostListing {
        id: string;
        title: string;
        instant_book: boolean;
        instant_book_requires_phone: boolean;
        min_nights: number | null;
        max_nights: number | null;
        advance_notice: string | null;
        preparation_time: string | null;
        availability_window: string | null;
        cancellation_policy: string | null;
        check_in_time: string | null;
        check_out_time: string | null;
        images: string[] | null;
        stl_licence_number: string | null;
        stl_licence_expiry: string | null;
        stl_licence_status: string | null;
    }
    const [hostListings, setHostListings] = useState<HostListing[]>([]);
    const [savingListing, setSavingListing] = useState<string | null>(null);
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
                    .from('profile_private')
                    .select('full_name, preferred_name, phone, residential_address, show_full_name, avatar_url')
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
                    setAvatarUrl(profileData.avatar_url || null);
                }

                // host_bio lives on profiles (public-readable), not on the
                // private view, so it is read on its own.
                const { data: bioRow } = await supabase
                    .from('profiles')
                    .select('host_bio')
                    .eq('id', session.user.id)
                    .maybeSingle();
                if (bioRow) {
                    setHostBio(bioRow.host_bio || '');
                    setSavedBio(bioRow.host_bio || '');
                }

                // Scheduled messages load themselves, in
                // components/account/MessageTemplates.tsx.

                const { data: myListings } = await supabase
                    .from('listings')
                    .select('id, title, instant_book, instant_book_requires_phone, min_nights, max_nights, advance_notice, preparation_time, availability_window, cancellation_policy, check_in_time, check_out_time, images, stl_licence_number, stl_licence_expiry, stl_licence_status')
                    .eq('host_id', session.user.id)
                    .order('created_at', { ascending: true });
                setHostListings(myListings || []);

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

        // UPDATE, NOT UPSERT, AND NOT WRITING email.
        //
        // This was an upsert on the reasoning that the profiles row might not
        // exist. It always does: add_profile_for_new_user is an AFTER INSERT
        // trigger on auth.users and creates it with id, email, full_name and
        // is_host before anybody can reach this page.
        //
        // The upsert was not merely redundant, it was broken. PostgREST
        // compiles it to INSERT ... ON CONFLICT DO UPDATE, which needs SELECT
        // on every column it writes — and 20260828234003 revoked table-level
        // SELECT on profiles, leaving email, phone and residential_address
        // unreadable on purpose. So every save here failed with
        // "permission denied for table profiles" from the moment that
        // migration reached production.
        //
        // An update needs only UPDATE on the column, which
        // 20260829010000 grants for exactly the six fields this page edits.
        // email is dropped from the payload because it is the trigger's to
        // write and was only ever here to satisfy the upsert.
        const { error } = await supabase
            .from('profiles')
            .update({ [field.key]: draftValue })
            .eq('id', session.user.id);

        setSaving(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        setProfile((prev) => ({ ...prev, [field.key]: draftValue }));
        setEditingField(null);
        router.refresh();
    };

    const saveBio = async () => {
        if (!session?.user) return;
        setSavingBio(true);
        const value = hostBio.trim().slice(0, 500);
        const { error } = await supabase
            .from('profiles')
            .update({ host_bio: value || null })
            .eq('id', session.user.id);
        setSavingBio(false);
        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }
        setSavedBio(value);
        setHostBio(value);
        toast.success('Saved. This shows on your listings.', { theme: 'colored' });
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
            .update({ residential_address: combined })
            .eq('id', session.user.id);

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

    // --- Profile photo ---

    const uploadAvatar = async (file: File) => {
        if (!session?.user) return;

        if (file.size > 5 * 1024 * 1024) {
            toast.error('That image is over 5MB — please pick a smaller one.', { theme: 'colored' });
            return;
        }

        setUploadingAvatar(true);

        // Shrunk the same way listing photos are. Without this a profile photo
        // went to storage at whatever the phone produced — 4000px and several
        // megabytes, to be shown in a 32px circle.
        let ready = file;
        try {
            ready = await compressImage(file);
        } catch (err) {
            setUploadingAvatar(false);
            toast.error('That image couldn\u2019t be read. Try a different one.', { theme: 'colored' });
            return;
        }

        // Always .jpg: compressImage re-encodes to JPEG whatever went in, so
        // taking the extension from the original name would put JPEG bytes
        // behind a .heic or .png path.
        const path = `avatars/${session.user.id}-${Date.now()}.jpg`;

        const { error: uploadError } = await supabase.storage
            .from(Env.S3_BUCKET)
            .upload(path, ready, { upsert: true, contentType: 'image/jpeg' });

        if (uploadError) {
            setUploadingAvatar(false);
            toast.error(uploadError.message, { theme: 'colored' });
            return;
        }

        const { error } = await supabase
            .from('profiles')
            .update({ avatar_url: path })
            .eq('id', session.user.id);

        setUploadingAvatar(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        setAvatarUrl(path);
        router.refresh();
        toast.success('Profile photo updated.', { theme: 'colored' });
    };

    const removeAvatar = async () => {
        if (!session?.user) return;
        setUploadingAvatar(true);

        const { error } = await supabase
            .from('profiles')
            .update({ avatar_url: null })
            .eq('id', session.user.id);

        setUploadingAvatar(false);
        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }
        setAvatarUrl(null);
        router.refresh();
    };

    // --- Privacy handlers ---

    const toggleShowFullName = async (next: boolean) => {
        if (!session?.user) return;
        setSavingPrivacy(true);
        setShowFullName(next);

        const { error } = await supabase
            .from('profiles')
            .update({ show_full_name: next })
            .eq('id', session.user.id);

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
            // listing_private: your own listings with their sensitive columns,
            // which are revoked from the base table for the browser role.
            const listingsRes = await supabase.from('listing_private').select('*').eq('host_id', uid);
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

    // --- Booking permissions handlers ---

    const updateListingBooking = async (id: string, patch: Partial<HostListing>) => {
        setSavingListing(id);
        setHostListings((prev) => prev.map((l) => (l.id === id ? Object.assign({}, l, patch) : l)));

        const { error } = await supabase.from('listings').update(patch).eq('id', id);
        setSavingListing(null);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }
        toast.success('Saved.', { theme: 'colored' });
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

    // The page used to spend its loading second as a centred spinner and then
    // swap to the two-column grid, so everything on it appeared in the middle
    // of the screen and jumped right the moment the fetch landed. The shell is
    // the same either way, so draw it straight away and leave the waiting to
    // the content column: nothing moves when the answer arrives.
    if (loading) {
        return (
            <div className="max-w-5xl mx-auto px-6 py-10 w-full">
                <h1 className="text-3xl font-extrabold text-slate-900 mb-8">Account settings</h1>

                <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-10">
                    <div className="space-y-1">
                        {SECTIONS.map(({ key, label, icon: Icon }) => (
                            <div
                                key={key}
                                className="w-full flex items-center px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300"
                            >
                                <Icon className="w-4 h-4 mr-3" /> {label}
                            </div>
                        ))}
                    </div>

                    <div className="animate-pulse">
                        <div className="h-8 w-56 bg-slate-100 rounded-lg mb-6" />
                        <div className="h-24 bg-slate-100 rounded-2xl mb-5" />
                        <div className="h-64 bg-slate-100 rounded-2xl" />
                    </div>
                </div>
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

                            <div className="border rounded-2xl p-5 mb-5 flex items-center gap-5">
                                <div className="w-20 h-20 rounded-full overflow-hidden bg-slate-900 text-white flex items-center justify-center text-2xl font-semibold flex-shrink-0">
                                    {avatarUrl ? (
                                        <img src={getImageUrl(avatarUrl)} alt="Your profile photo" className="w-full h-full object-cover" />
                                    ) : (
                                        (profile.preferred_name || profile.full_name || 'G').charAt(0).toUpperCase()
                                    )}
                                </div>
                                <div>
                                    <div className="font-semibold text-slate-900 text-sm mb-1">Profile photo</div>
                                    <p className="text-xs text-slate-500 mb-3">
                                        Shown to hosts and guests you book with. A clear photo of your face helps
                                        people know who they&apos;re dealing with.
                                    </p>
                                    <div className="flex items-center gap-3">
                                        <label className={`px-4 py-2 text-sm font-semibold rounded-lg cursor-pointer ${uploadingAvatar ? 'bg-slate-300 text-white' : 'bg-slate-900 hover:bg-black text-white'}`}>
                                            {uploadingAvatar ? 'Uploading...' : avatarUrl ? 'Change photo' : 'Upload photo'}
                                            <input
                                                type="file"
                                                accept="image/png, image/jpeg, image/webp"
                                                disabled={uploadingAvatar}
                                                onChange={(e) => {
                                                    const file = e.target.files && e.target.files[0];
                                                    if (file) uploadAvatar(file);
                                                    e.target.value = '';
                                                }}
                                                className="hidden"
                                            />
                                        </label>
                                        {avatarUrl && (
                                            <button
                                                type="button"
                                                onClick={removeAvatar}
                                                disabled={uploadingAvatar}
                                                className="text-sm text-slate-500 hover:text-red-600 disabled:opacity-40"
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="border rounded-2xl p-5">
                                <div className="font-semibold text-slate-900 text-sm mb-1">About you</div>
                                <p className="text-xs text-slate-500 mb-3">
                                    A line or two shown on your listings, under your name. Guests booking direct
                                    want to know who they&apos;re dealing with — that you&apos;re local, that you
                                    answer the phone. Keep it short and human.
                                </p>
                                <textarea
                                    value={hostBio}
                                    onChange={(e) => setHostBio(e.target.value)}
                                    maxLength={500}
                                    rows={4}
                                    placeholder="e.g. We live just up the road in Kirkcudbright and have let this cottage for years. Message any time — we usually reply within the hour."
                                    className="w-full p-3 border rounded-xl text-sm"
                                />
                                <div className="flex items-center justify-between mt-2">
                                    <span className="text-xs text-slate-400">{hostBio.length}/500</span>
                                    <button
                                        type="button"
                                        onClick={saveBio}
                                        disabled={savingBio || hostBio.trim() === savedBio.trim()}
                                        className="px-4 py-2 text-sm font-semibold rounded-lg bg-slate-900 hover:bg-black text-white disabled:opacity-40"
                                    >
                                        {savingBio ? 'Saving…' : 'Save'}
                                    </button>
                                </div>
                            </div>

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
                                            {/* Said here as well as in the privacy policy, because this
                                                is where the promise is read. Without it the sentence
                                                above reads as "nobody sees my legal name", which is not
                                                what the switch does. */}
                                            <p className="text-xs text-slate-400 mt-2">
                                                Galloway Getaways staff can still see your legal name when
                                                approving a listing or sorting out a problem with a booking.
                                            </p>
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

                            <MessageTemplates />

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
                                            qrEditingId === reply.id ? (
                                                /* Editing happens right here, in the row you clicked */
                                                <div key={reply.id} className="p-4 bg-slate-50">
                                                    <div className="text-xs font-semibold text-slate-500 mb-3">
                                                        Editing this quick reply
                                                    </div>
                                                    <div className="space-y-3">
                                                        <div>
                                                            <label className="text-xs text-slate-500">Shortcut name</label>
                                                            <input
                                                                type="text"
                                                                value={qrTitle}
                                                                onChange={(e) => setQrTitle(e.target.value)}
                                                                className="w-full p-2.5 border rounded-lg text-sm mt-1 bg-white"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="text-xs text-slate-500">Message</label>
                                                            <textarea
                                                                value={qrBody}
                                                                onChange={(e) => setQrBody(e.target.value)}
                                                                rows={4}
                                                                className="w-full p-2.5 border rounded-lg text-sm mt-1 bg-white"
                                                            />
                                                        </div>
                                                        <div className="flex items-center space-x-3">
                                                            <button
                                                                type="button"
                                                                onClick={saveQuickReply}
                                                                disabled={savingQr || !qrTitle.trim() || !qrBody.trim()}
                                                                className="px-4 py-2.5 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                                            >
                                                                {savingQr ? 'Saving...' : 'Save changes'}
                                                            </button>
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
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
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
                                            )
                                        ))}
                                    </div>
                                )}

                                {/* Adding a new one — hidden while editing an existing one,
                                    so there's never two forms open at once */}
                                {!qrEditingId && (
                                    <div className="space-y-3 max-w-lg">
                                        <div className="text-xs font-semibold text-slate-500">
                                            Add a new quick reply
                                        </div>
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
                                        <button
                                            type="button"
                                            onClick={saveQuickReply}
                                            disabled={savingQr || !qrTitle.trim() || !qrBody.trim()}
                                            className="px-4 py-2.5 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {savingQr ? 'Saving...' : 'Add quick reply'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : activeSection === 'bookings' ? (
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 mb-1">Booking permissions</h2>
                            <p className="text-sm text-slate-500 mb-6">
                                Decide how guests can book each of your places.
                            </p>

                            {hostListings.length === 0 ? (
                                <div className="border rounded-2xl p-10 text-center">
                                    <h3 className="text-lg font-semibold text-slate-800">No listings yet</h3>
                                    <p className="text-slate-500 text-sm mt-1">
                                        Once you&apos;ve added a place, its booking settings will appear here.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-5">
                                    {hostListings.map((l) => {
                                        const busy = savingListing === l.id;
                                        return (
                                            <div key={l.id} className="border rounded-2xl p-5">
                                                <div className="font-semibold text-slate-900 text-sm mb-4">
                                                    {l.title || 'Untitled listing'}
                                                </div>

                                                {/* Scottish short-term let licence */}
                                                <div className="border rounded-xl p-4 mb-5 bg-slate-50">
                                                    <div className="font-semibold text-slate-900 text-sm mb-1">
                                                        Short-term let licence
                                                    </div>
                                                    <p className="text-xs text-slate-500 mb-3">
                                                        Required by law in Scotland. Your licence number is shown on this
                                                        listing, as the rules require it to appear on any advert.
                                                    </p>

                                                    <div className="flex flex-wrap gap-3">
                                                        <label className="text-xs text-slate-600 flex-1 min-w-[150px]">
                                                            Status
                                                            <select
                                                                value={l.stl_licence_status || 'none'}
                                                                disabled={busy}
                                                                onChange={(e) => updateListingBooking(l.id, { stl_licence_status: e.target.value })}
                                                                className="w-full border rounded-lg p-2 text-sm mt-1 bg-white disabled:opacity-50"
                                                            >
                                                                <option value="none">Not provided</option>
                                                                <option value="licensed">Licensed</option>
                                                                <option value="applied">Application submitted</option>
                                                                <option value="exempt">Exempt</option>
                                                            </select>
                                                        </label>

                                                        <label className="text-xs text-slate-600 flex-1 min-w-[150px]">
                                                            Licence number
                                                            <input
                                                                type="text"
                                                                defaultValue={l.stl_licence_number || ''}
                                                                disabled={busy}
                                                                placeholder="ABC12345"
                                                                maxLength={20}
                                                                onBlur={(e) => {
                                                                    const next = e.target.value.trim().toUpperCase();
                                                                    if (next !== (l.stl_licence_number || '')) {
                                                                        updateListingBooking(l.id, { stl_licence_number: next });
                                                                    }
                                                                }}
                                                                className="w-full border rounded-lg p-2 text-sm mt-1 bg-white disabled:opacity-50"
                                                            />
                                                        </label>

                                                        <label className="text-xs text-slate-600 flex-1 min-w-[150px]">
                                                            Expires
                                                            <input
                                                                type="date"
                                                                defaultValue={(l.stl_licence_expiry || '').slice(0, 10)}
                                                                disabled={busy}
                                                                onBlur={(e) => {
                                                                    if (e.target.value !== (l.stl_licence_expiry || '')) {
                                                                        updateListingBooking(l.id, { stl_licence_expiry: e.target.value || null });
                                                                    }
                                                                }}
                                                                className="w-full border rounded-lg p-2 text-sm mt-1 bg-white disabled:opacity-50"
                                                            />
                                                        </label>
                                                    </div>

                                                    {licenceWarning(l) && (
                                                        <p className="text-xs text-amber-600 mt-3">{licenceWarning(l)}</p>
                                                    )}
                                                </div>

                                                {/* How guests book */}
                                                <div className="space-y-2 mb-4">
                                                    <button
                                                        type="button"
                                                        disabled={busy}
                                                        onClick={() => updateListingBooking(l.id, { instant_book: false })}
                                                        className={`w-full text-left px-4 py-3.5 rounded-xl border transition disabled:opacity-50 ${!l.instant_book ? 'border-slate-900 border-2' : 'border-slate-200 hover:border-slate-400'}`}
                                                    >
                                                        <div className={`text-sm ${!l.instant_book ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                                                            Request to book
                                                        </div>
                                                        <div className="text-xs text-slate-500 mt-0.5">
                                                            You review each request and choose whether to accept. Dates aren&apos;t
                                                            held until you do.
                                                        </div>
                                                    </button>

                                                    <button
                                                        type="button"
                                                        disabled={busy}
                                                        onClick={() => updateListingBooking(l.id, { instant_book: true })}
                                                        className={`w-full text-left px-4 py-3.5 rounded-xl border transition disabled:opacity-50 ${l.instant_book ? 'border-slate-900 border-2' : 'border-slate-200 hover:border-slate-400'}`}
                                                    >
                                                        <div className={`text-sm ${l.instant_book ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                                                            Instant Book
                                                        </div>
                                                        <div className="text-xs text-slate-500 mt-0.5">
                                                            Guests book straight away without waiting for you. The dates block
                                                            immediately, so make sure your calendar is accurate.
                                                        </div>
                                                    </button>
                                                </div>

                                                {/* Requirements — only relevant for instant book */}
                                                {l.instant_book && (
                                                    <div className="border-t pt-4 mb-4">
                                                        <div className="text-xs font-semibold text-slate-700 mb-3">
                                                            Guests must meet these before booking instantly
                                                        </div>

                                                        <div className="flex items-start justify-between">
                                                            <div className="pr-6">
                                                                <div className="font-semibold text-slate-900 text-sm mb-1">
                                                                    Phone number on file
                                                                </div>
                                                                <p className="text-xs text-slate-500">
                                                                    A lighter check — the guest just needs a phone number saved on
                                                                    their profile. Works today.
                                                                </p>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                role="switch"
                                                                aria-checked={l.instant_book_requires_phone}
                                                                aria-label="Require a phone number"
                                                                disabled={busy}
                                                                onClick={() => updateListingBooking(l.id, { instant_book_requires_phone: !l.instant_book_requires_phone })}
                                                                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${l.instant_book_requires_phone ? 'bg-emerald-700' : 'bg-slate-300'}`}
                                                            >
                                                                <span
                                                                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${l.instant_book_requires_phone ? 'translate-x-5' : 'translate-x-0.5'}`}
                                                                />
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Check-in and check-out times used to be here as well as in the
                                                    listing editor — two controls writing the same columns, with
                                                    nothing to say which had been used last. They live on the
                                                    listing now, which is also the only way to give two properties
                                                    different times. */}

                                                <div className="border-t pt-4">
                                                    <div className="text-xs font-semibold text-slate-700 mb-2">
                                                        Current stay rules
                                                    </div>
                                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                                                        <dt className="text-slate-500">Minimum nights</dt>
                                                        <dd className="text-slate-800">{l.min_nights || 1}</dd>
                                                        <dt className="text-slate-500">Maximum nights</dt>
                                                        <dd className="text-slate-800">{l.max_nights || 'No limit'}</dd>
                                                        <dt className="text-slate-500">Advance notice</dt>
                                                        <dd className="text-slate-800">{l.advance_notice || 'Same day'}</dd>
                                                        <dt className="text-slate-500">Preparation time</dt>
                                                        <dd className="text-slate-800">{l.preparation_time || 'None'}</dd>
                                                        <dt className="text-slate-500">Booking window</dt>
                                                        <dd className="text-slate-800">{l.availability_window || '9 months'}</dd>
                                                        <dt className="text-slate-500">Cancellation policy</dt>
                                                        <dd className="text-slate-800">{l.cancellation_policy || 'Moderate'}</dd>
                                                        <dt className="text-slate-500">Check-in from</dt>
                                                        <dd className="text-slate-800">{formatTime(l.check_in_time) || '3pm'}</dd>
                                                        <dt className="text-slate-500">Checkout by</dt>
                                                        <dd className="text-slate-800">{formatTime(l.check_out_time) || '11am'}</dd>
                                                    </dl>
                                                    <p className="text-xs text-slate-400 mt-3">
                                                        These are set per listing so they stay in one place — edit nights, notice
                                                        and booking window on your{' '}
                                                        <Link href="/dashboard/calendar" className="underline hover:text-slate-700">
                                                            calendar
                                                        </Link>
                                                        , and the cancellation policy in the{' '}
                                                        <Link href={`/edit-listing/${l.id}`} className="underline hover:text-slate-700">
                                                            listing editor
                                                        </Link>
                                                        .
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ) : activeSection === 'notifications' ? (
                        <NotificationsSection />
                    ) : activeSection === 'payments' ? (
                        <PaymentsSection />
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


            {/* Choose listings */}

            {/* Schedule picker */}
        </div>
    );
}
