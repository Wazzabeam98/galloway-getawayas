// The host pages sit on the platform tint, bg-slate-50, so the lifted cards on
// them (the listing editor's section cards, the dashboard's listing cards) are
// the brightest thing on the screen — a white card on a white page cannot lift,
// whatever shadow it carries. Same wrapper height as the booking and trip
// pages: the viewport less the 81px header. The footer keeps a mt-20 gap
// above it; -mb-20 cancels that and pb-20 puts the room back inside the tint,
// so the grey runs down to the footer instead of stopping in a white band.
export default function HostPagesLayout({ children }: { children: React.ReactNode }) {
    return <div className="-mb-20 pb-20 min-h-[calc(100dvh-81px)] bg-slate-50">{children}</div>;
}
