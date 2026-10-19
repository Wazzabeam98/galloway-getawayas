import { requireAdmin } from '@/lib/access';
import Link from 'next/link';
import PushTestButton from './PushTestButton';

export const dynamic = 'force-dynamic';

// Push notifications, from the owner's side: a button that sends the three
// kinds of notification to YOUR OWN devices, so you can see them arrive on
// your phone. Made-up details; nothing about any real booking is touched.
export default async function AdminNotifications() {
    await requireAdmin();

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-900">&larr; Owner tools</Link>
            <h1 className="text-2xl font-bold text-slate-900 mt-3 mb-1">Push notifications</h1>
            <p className="text-sm text-slate-500 mb-8">
                Sends a test of each notification to the devices where you have turned notifications on:
                a host&rsquo;s new booking, a new message, and a guest&rsquo;s confirmed booking, ten seconds
                apart. They use the real wording with made-up details, and each title starts with
                &ldquo;TEST&rdquo;. Only you receive them, and no booking or message is created.
            </p>
            <PushTestButton />
        </div>
    );
}
