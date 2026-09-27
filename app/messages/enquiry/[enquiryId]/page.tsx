import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Folded into the three-pane messages inbox: a job thread now opens at
// /messages?e=<id> with its reservation card on the right. Kept as a redirect so
// old links (emails, bookmarks) still land in the right place.
export default function EnquiryThreadRedirect({ params }: { params: { enquiryId: string } }) {
    redirect('/messages?e=' + params.enquiryId);
}
