// =====================================================================
// GALLOWAY GETAWAYS — Account settings → Notifications
// WHERE THIS GOES: GitHub → components/account/NotificationsSection.tsx
//                  (NEW FILE — you'll need to create the "account"
//                   folder inside "components")
// =====================================================================

'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { toast } from 'react-toastify';
import { Mail, MessageCircle, CalendarCheck, Star, Megaphone, Check } from 'lucide-react';

interface Prefs {
    new_message: boolean;
    booking_reminders: boolean;
    review_prompts: boolean;
    marketing: boolean;
}

const OPTIONAL: Array<{ key: keyof Prefs; label: string; description: string; icon: any }> = [
    {
        key: 'new_message',
        label: 'Messages',
        description: 'Email me when a guest or host sends me a message, so I don\u2019t miss it.',
        icon: MessageCircle,
    },
    {
        key: 'booking_reminders',
        label: 'Trip reminders',
        description: 'Check-in details before a stay, and a nudge the day before check-out.',
        icon: CalendarCheck,
    },
    {
        key: 'review_prompts',
        label: 'Review reminders',
        description: 'A reminder to leave a review after a stay has finished.',
        icon: Star,
    },
    {
        key: 'marketing',
        label: 'News and offers',
        description: 'Occasional emails about new places to stay in Dumfries & Galloway. Never more than once a month.',
        icon: Megaphone,
    },
];

const ALWAYS_ON = [
    'Booking requests, confirmations, declines and cancellations',
    'Password resets and email address changes',
    'Anything we\u2019re legally required to tell you about your booking',
];

export default function NotificationsSection() {
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState<string | null>(null);
    const [email, setEmail] = useState('');
    const [prefs, setPrefs] = useState<Prefs>({
        new_message: true,
        booking_reminders: true,
        review_prompts: true,
        marketing: false,
    });
    const [savingKey, setSavingKey] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();

            if (!session || !session.user) {
                setLoading(false);
                return;
            }

            setUserId(session.user.id);
            setEmail(session.user.email || '');

            const { data } = await supabase
                .from('notification_preferences')
                .select('new_message, booking_reminders, review_prompts, marketing')
                .eq('user_id', session.user.id)
                .maybeSingle();

            if (data) {
                setPrefs({
                    new_message: data.new_message !== false,
                    booking_reminders: data.booking_reminders !== false,
                    review_prompts: data.review_prompts !== false,
                    marketing: data.marketing === true,
                });
            } else {
                // No row yet (an account created before this was added).
                // Make one now so the toggles have something to save to.
                await supabase.from('notification_preferences').insert({ user_id: session.user.id });
            }

            setLoading(false);
        };
        load();
    }, [supabase]);

    const toggle = async (key: keyof Prefs) => {
        if (!userId) return;

        const next = !prefs[key];
        const previous = prefs[key];

        // Move the switch straight away, put it back if the save fails.
        setPrefs((p) => ({ ...p, [key]: next }));
        setSavingKey(key);

        const patch: Record<string, any> = { user_id: userId, updated_at: new Date().toISOString() };
        patch[key] = next;

        const { error } = await supabase
            .from('notification_preferences')
            .upsert(patch, { onConflict: 'user_id' });

        setSavingKey(null);

        if (error) {
            setPrefs((p) => ({ ...p, [key]: previous }));
            toast.error('That setting couldn\u2019t be saved. Please try again.', { theme: 'colored' });
        }
    };

    if (loading) {
        return (
            <div className="border rounded-2xl p-10 text-center">
                <p className="text-slate-400 text-sm animate-pulse">Loading your notification settings...</p>
            </div>
        );
    }

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-1">Notifications</h2>
            <p className="text-slate-500 text-sm mb-8">
                Choose what we email you about. We send to{' '}
                <span className="font-medium text-slate-700">{email || 'your account email'}</span>.
            </p>

            <div className="border rounded-2xl divide-y">
                {OPTIONAL.map(({ key, label, description, icon: Icon }) => {
                    const on = prefs[key];
                    return (
                        <div key={key} className="flex items-start justify-between gap-4 p-5">
                            <div className="flex gap-3.5">
                                <Icon className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
                                <div>
                                    <div className="text-sm font-semibold text-slate-900">{label}</div>
                                    <p className="text-sm text-slate-500 mt-0.5">{description}</p>
                                </div>
                            </div>

                            <button
                                type="button"
                                role="switch"
                                aria-checked={on}
                                aria-label={label}
                                disabled={savingKey === key}
                                onClick={() => toggle(key)}
                                className={`relative w-12 h-7 rounded-full shrink-0 transition disabled:opacity-50 ${on ? 'bg-emerald-700' : 'bg-slate-300'}`}
                            >
                                <span
                                    className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-all ${on ? 'left-6' : 'left-1'}`}
                                />
                            </button>
                        </div>
                    );
                })}
            </div>

            <div className="mt-8 border rounded-2xl p-5 bg-slate-50">
                <div className="flex gap-3.5">
                    <Mail className="w-5 h-5 text-slate-400 mt-0.5 shrink-0" />
                    <div>
                        <div className="text-sm font-semibold text-slate-900">Emails we always send</div>
                        <p className="text-sm text-slate-500 mt-0.5 mb-3">
                            These keep your bookings and your account working, so they can&apos;t be switched off.
                        </p>
                        <ul className="space-y-1.5">
                            {ALWAYS_ON.map((item) => (
                                <li key={item} className="flex items-start gap-2 text-sm text-slate-600">
                                    <Check className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>

            <p className="text-xs text-slate-400 mt-6">
                Changes save as soon as you tap. If an email ends up in your junk folder, marking it &ldquo;not
                spam&rdquo; helps future ones arrive properly.
            </p>
        </div>
    );
}
