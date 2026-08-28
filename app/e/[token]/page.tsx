import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// The short link that goes in a text message.
//
// WHY IT EXISTS: a single GSM-7 segment is 160 characters, and
// /services/enquiry/<token> spends 47 of them on the path alone before the
// token. /e/ spends three. What that buys is the trade and the town fitting in
// the same segment, which is what a tradesman actually reads on a lock screen.
//
// It is a redirect and nothing else. No token is checked here, nothing is
// written, and the page it lands on does exactly what it did before — marking
// the enquiry opened, and requiring a press to answer. Adding logic here would
// mean two places that can accept an enquiry.
export default function ShortEnquiryLink({ params }: { params: { token: string } }) {
    redirect('/services/enquiry/' + String(params.token || ''));
}
