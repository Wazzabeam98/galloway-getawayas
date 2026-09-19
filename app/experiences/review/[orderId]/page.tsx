import Link from 'next/link';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import LoginModel from '@/components/auth/LoginModel';
import ExperienceReviewForm from '@/components/marketplace/ExperienceReviewForm';

export const dynamic = 'force-dynamic';

// Leave a review for a completed experience. The twin of app/review/[bookingId]
// for cottage stays, but an experience is not a place you check into, so there
// are no cleanliness / check-in / location categories — one overall rating and a
// comment, the honest shape of "how was it".
//
// The real gate is the database (the "Guests can review after a completed
// experience" RLS policy + the check_experience_review_window trigger). This
// screen decides eligibility a second time as a belt — but it MUST do it on the
// server: a guest has no SELECT on service_orders (the app only ever reads an
// order through the service role), so the order is read here with the admin
// client and the same yes/no reached before the form is shown. The insert stays
// in the browser, where RLS authorises it.

function Notice({ title }: { title: string }) {
    return (
        <div className="mx-auto max-w-md px-6 py-24 text-center">
            <h1 className="mb-2 text-2xl font-bold text-slate-900">{title}</h1>
            <Link href="/trips" className="mt-6 inline-block rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800">
                Back to your trips
            </Link>
        </div>
    );
}

export default async function ExperienceReviewPage({ params }: { params: { orderId: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return (
            <div className="mx-auto max-w-md px-6 py-24 text-center">
                <h1 className="mb-2 text-2xl font-bold text-slate-900">Sign in to leave your review</h1>
                <p className="mb-6 text-slate-500">You’ll need to be signed in to the account that booked it.</p>
                <LoginModel />
            </div>
        );
    }

    const admin = adminClient();
    const { data: order } = await admin
        .from('service_orders')
        .select('id, guest_id, status, service_date, item_name, provider_business_name')
        .eq('id', params.orderId)
        .maybeSingle();

    if (!order) return <Notice title="We couldn’t find that booking." />;
    if (order.guest_id !== user.id) return <Notice title="This isn’t your booking to review." />;
    if (order.status !== 'confirmed') return <Notice title="You can review an experience once it’s booked and paid." />;

    const experienceOver = new Date(String(order.service_date) + 'T00:00:00') < new Date(new Date().toDateString());
    if (!experienceOver) return <Notice title="You can leave a review once the experience has taken place." />;

    const { data: existing } = await admin
        .from('reviews')
        .select('id')
        .eq('order_id', order.id)
        .eq('reviewer_id', user.id)
        .maybeSingle();
    if (existing) return <Notice title="You’ve already reviewed this experience. Thanks!" />;

    return (
        <ExperienceReviewForm
            orderId={order.id}
            reviewerId={user.id}
            who={order.provider_business_name || 'the provider'}
        />
    );
}
