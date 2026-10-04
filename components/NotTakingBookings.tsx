// Stands where the booking card would be, on a cottage that has been hidden or
// an experience its provider has paused. The page stays up for anyone holding
// an old link — the way Airbnb treats an unlisted place — but there is nothing
// to pick and nothing to pay. Same card frame as the booking panel it replaces,
// so the column doesn't jump.
export default function NotTakingBookings({ message }: { message: string }) {
    return (
        <div
            role="status"
            className="bg-white border border-slate-200 rounded-2xl p-5 lg:sticky lg:top-24 shadow-[0_6px_16px_rgba(0,0,0,0.12)]"
        >
            <p className="text-lg font-semibold text-slate-900">{message}</p>
        </div>
    );
}
