import { adminClient } from '@/lib/supabaseAdmin';
import {
    hashToken, linkExpired, daysUntilDeleted, LINK_DAYS, RETENTION_DAYS, ApplicationRow,
} from '@/lib/serviceApplications';
import FinishForm from '@/components/services/FinishForm';
import ResendLink from '@/components/services/ResendLink';

export const dynamic = 'force-dynamic';

// noindex: it is addressed by a bearer token and there is nothing here for a
// search engine even to reach.
export const metadata = {
    title: 'Finish your application | Galloway Getaways',
    robots: { index: false, follow: false },
};

function formatDay(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

// Four states, and the difference between them matters to the person reading.
//
// The one that decided the shape of this page is EXPIRED. A tradesman who
// applies on a Friday and spends a fortnight on a job comes back to a dead
// link, and the only question in his head is whether he has to type it all
// again. So that is the first sentence he reads, and the answer is no.
export default async function FinishPage({ params }: { params: { token: string } }) {
    const admin = adminClient();

    const { data } = await admin
        .from('service_applications')
        .select('id, email, name, trade, business_name, contact_phone, payload, token_sent_at, resend_count, last_resend_at, created_at, claimed_at, provider_id')
        .eq('token_hash', hashToken(decodeURIComponent(params.token || '')))
        .maybeSingle();

    const application = data as ApplicationRow | null;

    const shell = (children: React.ReactNode) => (
        <main className="max-w-md mx-auto px-6 py-16">{children}</main>
    );

    if (!application) {
        return shell(
            <>
                <p className="text-xs font-semibold tracking-widest uppercase text-emerald-800 mb-3">
                    Galloway Getaways
                </p>
                <h1 className="text-2xl font-bold text-slate-900 mb-2">We do not recognise that link</h1>
                <p className="text-slate-600">
                    It may have been used already, or it may be older than {RETENTION_DAYS} days —
                    we do not keep applications longer than that. Start again at{' '}
                    <a className="text-emerald-800 font-medium underline" href="/services/join">
                        Set up a business
                    </a>
                    , or reply to any of our emails and we will find you.
                </p>
            </>
        );
    }

    if (application.claimed_at) {
        return shell(
            <>
                <p className="text-xs font-semibold tracking-widest uppercase text-emerald-800 mb-3">
                    Galloway Getaways
                </p>
                <h1 className="text-2xl font-bold text-slate-900 mb-2">
                    {application.business_name} is already with us
                </h1>
                <p className="text-slate-600 mb-6">
                    This link has been used, and your application is in front of the team. Sign in
                    to change anything.
                </p>
                <a
                    href="/services/join"
                    className="block text-center bg-emerald-700 text-white font-semibold rounded-xl py-3 hover:bg-emerald-800 transition"
                >
                    Sign in
                </a>
            </>
        );
    }

    if (linkExpired(application)) {
        const left = daysUntilDeleted(application);

        return shell(
            <>
                <p className="text-xs font-semibold tracking-widest uppercase text-emerald-800 mb-3">
                    Galloway Getaways
                </p>
                <h1 className="text-2xl font-bold text-slate-900 mb-2">That link has expired</h1>
                <p className="text-slate-600 mb-6">
                    Links last {LINK_DAYS} days, and this one was sent on{' '}
                    {formatDay(application.token_sent_at)}.{' '}
                    <strong className="text-slate-900">Nothing you typed has been lost</strong> — your
                    application for {application.business_name} is still here, exactly as you left it.
                </p>

                <ResendLink applicationId={application.id} email={application.email} />

                <p className="text-sm text-slate-500 mt-6 pt-4 border-t border-slate-200">
                    Applications are kept for {RETENTION_DAYS} days from the day they are sent. After
                    that we delete them and you would need to fill the form in again.{' '}
                    {left > 0
                        ? <>Yours has <strong className="text-slate-700">{left} day{left === 1 ? '' : 's'}</strong> left.</>
                        : <>Yours is due to be deleted today — press the button above now.</>}
                </p>
            </>
        );
    }

    return shell(
        <>
            <p className="text-xs font-semibold tracking-widest uppercase text-emerald-800 mb-3">
                Galloway Getaways
            </p>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
                Finish listing {application.business_name}
            </h1>
            <p className="text-slate-600 mb-7">
                Your application is saved. Pick a password so you can come back and change it, and we
                will put it in front of the team.
            </p>

            <FinishForm token={params.token} email={application.email} />

            <p className="text-sm text-slate-500 mt-7 pt-4 border-t border-slate-200">
                We read every application ourselves, usually within a couple of days, and we email you
                either way.
            </p>
        </>
    );
}
