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
  const legal = (profile.full_name || "").trim();

  if (legalAllowed && legal) return legal;
  return fallback;
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
