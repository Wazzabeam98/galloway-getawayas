// The page is a client component, so its metadata has to live here. Private to
// the host setting up payouts — never a search result.
export const metadata = { robots: { index: false, follow: false } };

export default function PayoutsSetupLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
