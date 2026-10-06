import { logError } from '@/lib/logError';
import { openSecret, sealSecret, type SecretPlace } from './secretBox';

// The read and write side of lib/secretBox for the routes and pages that hold
// door codes and wifi passwords. Server only: the key is a server environment
// variable, so this does nothing useful in a browser.

export { sealSecret };

// For a reader: the plain value, or null. A sealed value that won't open (the
// key missing or wrong in this environment) is logged — by place, never by
// value — and read as no value: a page shows nothing rather than gibberish, and
// the check-in sender holds the message back rather than send a blank code.
export async function revealSecret(stored: string | null | undefined, place: SecretPlace, where: string): Promise<string | null> {
    try {
        return openSecret(stored, place);
    } catch (err: any) {
        await logError(`listing secret could not be opened (${place.table})`, { id: place.id, message: String(err?.message || err) }, { path: where });
        return null;
    }
}
