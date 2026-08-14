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
} from 'lucide-react';

const SECTIONS = [
    { key: 'personal', label: 'Personal information', icon: User, ready: true },
    { key: 'security', label: 'Login & security', icon: Lock, ready: false },
    { key: 'privacy', label: 'Privacy', icon: Shield, ready: false },
    { key: 'notifications', label: 'Notifications', icon: Bell, ready: false },
    { key: 'payments', label: 'Payments & payouts', icon: CreditCard, ready: false },
    { key: 'messaging', label: 'Messaging', icon: MessageCircle, ready: false },
    { key: 'bookings', label: 'Booking permissions', icon: CalendarCheck, ready: false },
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

    const supabase = createClientComponentClient();
    const router = useRouter();

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (session?.user) {
                setEmail(session.user.email || '');
                const { data: profileData } = await supabase
                    .from('profiles')
                    .select('full_name, preferred_name, phone, residential_address')
                    .eq('id', session.user.id)
                    .single();

                if (profileData) {
                    setProfile({
                        full_name: profileData.full_name || '',
                        preferred_name: profileData.preferred_name || '',
                        phone: profileData.phone || '',
                        residential_address: profileData.residential_address || '',
                    });
                }
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
        </div>
    );
}
