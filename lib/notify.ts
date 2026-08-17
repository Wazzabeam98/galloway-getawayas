// =====================================================================
// GALLOWAY GETAWAYS — client-side notification trigger
// WHERE THIS GOES: GitHub → lib/notify.ts   (NEW FILE)
//
// Fire and forget. Nothing waits for it and nothing breaks if it fails
// — the booking or message has already been saved by the time this runs.
// =====================================================================

export function notify(type: 'booking_created' | 'booking_status' | 'new_message', bookingId: string, preview?: string): void {
    try {
        fetch('/api/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: type, bookingId: bookingId, preview: preview }),
        }).catch(function () {
            // Deliberately silent.
        });
    } catch (err) {
        // Deliberately silent.
    }
}
