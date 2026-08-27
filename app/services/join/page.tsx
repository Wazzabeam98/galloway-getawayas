// The provider sign-up.
//
// This used to be the trade picker, with the form on a route of its own at
// /services/join/apply. It is now one stepped modal and the trade is step one
// of it, so both live here — which is also where every link in the wild
// points: /business, and all four of the decision emails.
//
// The steps are in lib/joinSteps.ts and the form is in
// components/services/ProviderSignUp.tsx, which is a client component because
// the whole of it is state: what they have typed, which step they are on, and
// a draft written to local storage on every keystroke.

import ProviderSignUp from '@/components/services/ProviderSignUp';

export default function JoinPage() {
    return <ProviderSignUp />;
}
