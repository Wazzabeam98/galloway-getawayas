import { redirect } from 'next/navigation';

// The hotel owner side is the holiday-let host side now — one dashboard for
// everyone. This standalone route redirects to its equivalent there.
export default function Page() {
    redirect('/dashboard/calendar');
}
