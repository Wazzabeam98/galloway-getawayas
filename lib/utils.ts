import Env from "@/config/Env";
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// generateRandomNumber
export function generateRandomNumber(): number {
  const min = 200;
  const max = 2000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// byteToMb

export function byteToMb(bytes: number): number {
  const mb = 1048576;
  return bytes / mb;
}

export function getImageUrl(image: string): string {
  return `${Env.SUPABASE_URL}/storage/v1/object/public/${Env.S3_BUCKET}/${image}`;
}

// The SHARE image (og:image / twitter:image) for a listing or experience cover.
//
// A host's original is a 1–2 MB phone photo, which WhatsApp and Messenger refuse
// to fetch for a link preview — so the preview fell back to the site logo. This
// runs the same photo through Supabase's image transformation (our image
// optimisation): cropped to exactly 1200×630 and re-encoded small (~100 KB), it
// sits well under the size the social scrapers accept. It is an absolute https
// URL on the storage origin, and the scrapers (which send `Accept: */*`, not
// `image/webp`) are served JPEG. 1200×630 is the 1.91:1 ratio Facebook, WhatsApp
// and X all use for a large summary card.
export function shareImageUrl(image: string): string {
  return `${Env.SUPABASE_URL}/storage/v1/render/image/public/${Env.S3_BUCKET}/${image}?width=1200&height=630&resize=cover&quality=80`;
}

export function capitializeFirst(data: string): string {
  return `${data.charAt(0).toUpperCase()}${data.slice(1)}`;
}


// --- Display names -------------------------------------------------
// One rule for every place another person's name is shown.
//
// A preferred name always wins if it's set. If it isn't, we only fall
// back to the legal name when that person has left "Show my full legal
// name" switched on in Privacy. If they've switched it off and have no
// preferred name, we show the generic fallback instead of exposing the
// legal name they asked us to hide.
export interface NameProfile {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
  show_full_name?: boolean | null;
}

export function displayName(
  profile: NameProfile | null | undefined,
  fallback: string = "User"
): string {
  if (!profile) return fallback;

  const preferred = (profile.preferred_name || "").trim();
  if (preferred) return preferred;

  // Older rows may not have the column set; treat missing as "on",
  // which is how the site behaved before this setting existed.
  const legalAllowed = profile.show_full_name !== false;
  // The first and last name from Finish signing up (lib/personName) when the
  // account has them; the older single full_name otherwise, shown whole — for
  // an account that typed a business name there, the business name in full.
  const first = (profile.first_name || "").trim();
  const legal = first
    ? (first + " " + (profile.last_name || "").trim()).trim()
    : (profile.full_name || "").trim();

  if (legalAllowed && legal) return legal;
  return fallback;
}

// The listing TITLE for a guest experience — an individual person, not a
// business. A trading name wins if they set one (in account settings); otherwise
// the person's own name stands. business_name is DERIVED from this at write time
// and re-derived when either changes, so every read site keeps reading
// business_name unchanged. Falls back to displayName's own fallback last.
export function resolveTitle(
  profile: (NameProfile & { trading_name?: string | null }) | null | undefined,
  fallback: string = "User"
): string {
  const trading = (profile?.trading_name || "").trim();
  if (trading) return trading;
  return displayName(profile, fallback);
}

// The name to write to a profile that has none, or null to leave it be.
//
// A name typed at the account step is applied by Supabase only when the account
// is CREATED. A RETURNING applicant already has an account, so their typed name
// is ignored there — and if that account was made before names were captured,
// its full_name is empty and the derived listing title comes out blank. This
// closes that: after verifying, an empty full_name is filled from the typed
// name. It never overwrites a name already set, and never writes an empty one.
export function backfillName(existingFullName: string | null | undefined, typed: string): string | null {
    if ((existingFullName || '').trim()) return null;
    const name = (typed || '').trim();
    return name || null;
}

// The counterparty's FIRST name, honouring the same switch as displayName.
//
// Where two people message each other — a guest and their host — a first name
// is all either needs to hold a conversation, and neither should be handed the
// other's surname just for booking direct. This protects a host from a guest
// exactly as much as a guest from a host.
//
// It sits on top of displayName, so every promise that makes still holds: a
// preferred name wins, and the switch turned OFF with no preferred name yields
// the bare fallback ("Guest"/"Host"), never a shortened legal name.
//
// The first name is the account's own first_name — never the first word of a
// longer string. Splitting full_name is how "The Dark Sky Dome" was shown as
// "Hosted by The" (19 Oct 2026). When the row carries first_name (the caller
// selected it) and it is empty, there IS no first name: the fallback comes
// back whole, and a caller with a business name shows that in full instead.
// Only a row that never selected the column at all falls through to the old
// split, so a missed select degrades to yesterday's behaviour rather than to
// a blank; every profile select in the app now asks for first_name.
export function firstName(
  profile: NameProfile | null | undefined,
  fallback: string = "User"
): string {
  if (profile && Object.prototype.hasOwnProperty.call(profile, "first_name")) {
    const preferred = (profile.preferred_name || "").trim();
    if (preferred) return preferred;
    if (profile.show_full_name === false) return fallback;
    return (profile.first_name || "").trim() || fallback;
  }
  const shown = displayName(profile, fallback);
  return shown.trim().split(" ")[0] || fallback;
}

// The name a guest sees in "Hosted by …" for someone with no first name on
// their account yet: their trading name, else the business name the caller
// has (an experience's), else whatever single name the account holds, shown
// WHOLE — "Hosted by The Dark Sky Dome", never "Hosted by The". A host with
// a first name gets that, as before.
export function hostByline(
  profile: (NameProfile & { trading_name?: string | null }) | null | undefined,
  businessName: string | null | undefined,
  fallback: string
): string {
  const first = firstName(profile, "");
  if (first) return first;
  return (profile?.trading_name || "").trim()
    || (businessName || "").trim()
    || displayName(profile, "")
    || fallback;
}

// The name to greet someone by in a message to THEM ("Hi Morag"): their
// preferred name, else their own first name, else the fallback ("there"). The
// privacy switch doesn't apply — it is their own name, sent to them. Never the
// first word of full_name: an account named "The Dark Sky Dome" is greeted
// "Hi there", not "Hi The". A row that didn't select first_name falls back to
// the old split, the same as firstName above.
export function greetingName(
  profile: NameProfile | null | undefined,
  fallback: string = "there"
): string {
  if (!profile) return fallback;
  const preferred = (profile.preferred_name || "").trim();
  if (preferred) return preferred;
  if (Object.prototype.hasOwnProperty.call(profile, "first_name")) {
    return (profile.first_name || "").trim() || fallback;
  }
  return (profile.full_name || "").trim().split(/\s+/)[0] || fallback;
}

// The same person, named on an ADMIN screen.
//
// Deliberately ignores show_full_name. Approving a host, settling a payout or
// handling a dispute are decisions about a real person with a real legal name,
// and a director who cannot see who they are dealing with cannot make them.
// The switch is a promise to guests and hosts about what OTHER GUESTS AND
// HOSTS see; it was never a promise that the company does not know who its
// users are. The privacy policy says so in those words.
//
// Never call this from anything a guest or a host can load. Its only callers
// are under app/admin, which is behind an is_admin check.
export function adminName(
  profile: NameProfile | null | undefined,
  fallback: string = "User"
): string {
  if (!profile) return fallback;

  const legal = (profile.full_name || "").trim();
  if (legal) return legal;

  // No legal name on the account at all — a preferred name is better than
  // "Host" for working out who a row belongs to.
  const preferred = (profile.preferred_name || "").trim();
  return preferred || fallback;
}

// A time column comes back from PostgREST as "15:00:00". Guests should read
// "3pm". One place, so the listing page, the trip card, the confirmation page
// and the confirmation email cannot drift apart on how a time looks.
//
// Returns '' for null, which every caller treats as "not stated" rather than
// printing something misleading.
export function formatTime(value: string | null | undefined): string {
    if (!value) return '';

    const parts = String(value).split(':');
    const hour = Number(parts[0]);
    const minute = Number(parts[1] || 0);
    if (isNaN(hour) || isNaN(minute)) return '';

    const suffix = hour < 12 ? 'am' : 'pm';
    let display = hour % 12;
    if (display === 0) display = 12;

    // Midnight and noon read better by name than as 12am / 12pm.
    if (hour === 0 && minute === 0) return 'midnight';
    if (hour === 12 && minute === 0) return 'noon';

    return minute === 0
        ? display + suffix
        : display + ':' + String(minute).padStart(2, '0') + suffix;
}

// The value a <input type="time"> wants: "15:00:00" -> "15:00".
export function timeInputValue(value: string | null | undefined): string {
    if (!value) return '';
    return String(value).slice(0, 5);
}
