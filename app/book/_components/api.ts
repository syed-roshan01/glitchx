// Supabase access, error mapping and device storage for /book.
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { Contact } from './types';

type Client = ReturnType<typeof createBrowserSupabaseClient>;
let client: Client | null = null;

export function getSupabase(): Client {
  if (!client) client = createBrowserSupabaseClient();
  return client;
}

// ---------------------------------------------------------------- errors

export type RpcError = { message?: string; details?: string | null; hint?: string | null; code?: string } | null | undefined;

const MESSAGES: Record<string, string> = {
  SLOT_TAKEN: 'Someone just grabbed that slot — pick another time.',
  INVALID_START_TIME: 'That start time has already passed — pick a later slot.',
  TOO_FAR_AHEAD: 'That date is too far ahead — choose one closer to today.',
  INVALID_DURATION: 'Please choose a duration between 15 minutes and 8 hours.',
  INVALID_NAME: 'Please enter your name (at least 2 letters).',
  INVALID_MOBILE: 'That mobile number doesn’t look right — use 7 to 15 digits.',
  BOOKINGS_DISABLED: 'Online booking is paused right now — please call us or walk in.',
  RESOURCE_UNAVAILABLE: 'This station just went offline — please pick another one.',
  BOOKING_NOT_FOUND: 'We couldn’t find a booking with that code and mobile number.',
  BOOKING_NOT_CANCELLABLE: 'This booking can’t be cancelled any more — please speak to the counter.',
  WAITLIST_DISABLED: 'The waitlist is closed right now.',
  NOT_AVAILABLE: 'This feature isn’t available yet — please contact the cafe.',
  NETWORK: 'Can’t reach the server — check your connection and try again.',
};

/** Extract a known server error code from a Supabase/PostgREST error. */
export function errorCode(err: RpcError): string | null {
  if (!err) return null;
  const text = `${err.message ?? ''} ${err.details ?? ''} ${err.hint ?? ''}`;
  for (const code of Object.keys(MESSAGES)) {
    if (code !== 'NOT_AVAILABLE' && code !== 'NETWORK' && text.includes(code)) return code;
  }
  if (err.code === 'PGRST202' || err.code === '42883' || /could not find the function/i.test(text)) return 'NOT_AVAILABLE';
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(text)) return 'NETWORK';
  return null;
}

export function errorMessage(err: RpcError, fallback = 'Something went wrong — please try again.'): string {
  const code = errorCode(err);
  return (code && MESSAGES[code]) || fallback;
}

export function messageFor(code: string): string {
  return MESSAGES[code] ?? 'Something went wrong — please try again.';
}

// ---------------------------------------------------------------- validation

/** mirrors the server regex in public_create_booking */
const MOBILE_RE = /^\+?[0-9][0-9\s\-]{6,14}$/;

export function validateName(name: string): string | null {
  const n = name.trim();
  if (n.length < 2) return 'Please enter your name (at least 2 letters).';
  if (n.length > 120) return 'That name is a bit long — 120 characters max.';
  return null;
}

export function validateMobile(mobile: string): string | null {
  const m = mobile.trim();
  if (!m) return 'We need a mobile number to hold your booking.';
  if (!MOBILE_RE.test(m)) return 'Enter a valid mobile number (digits only, 7–15).';
  return null;
}

// ---------------------------------------------------------------- storage

const CONTACT_KEY = 'glitchx:book:contact';
const LAST_KEY = 'glitchx:book:last';

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

export function loadContact(): Contact | null {
  const c = read<Contact>(CONTACT_KEY);
  return c && typeof c.name === 'string' && typeof c.mobile === 'string' ? c : null;
}
export function saveContact(c: Contact | null) {
  write(CONTACT_KEY, c);
}

export interface LastBooking {
  code: string;
  mobile: string;
}
export function loadLastBooking(): LastBooking | null {
  const l = read<LastBooking>(LAST_KEY);
  return l && typeof l.code === 'string' && typeof l.mobile === 'string' ? l : null;
}
export function saveLastBooking(l: LastBooking | null) {
  write(LAST_KEY, l);
}
