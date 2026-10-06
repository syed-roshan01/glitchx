// Local types for the public booking page (kept here so /book is self-contained).

export type Step = 'station' | 'when' | 'details' | 'review';

export interface PublicSettings {
  cafe_name: string | null;
  phone: string | null;
  address: string | null;
  timezone: string | null;
  currency_symbol: string | null;
  allow_public_bookings: boolean | null;
  waitlist_enabled: boolean | null;
  booking_max_days_ahead: number | null;
}

export type BusyKind = 'BOOKING' | 'SCHEDULED' | 'LIVE';

export interface BusySlot {
  resource_id: string;
  start_time: string;
  /** null = open-ended live session */
  end_time: string | null;
  kind: BusyKind;
}

export interface BookingResult {
  id?: string;
  booking_code: string;
  resource_name: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  estimated_amount: number | string | null;
}

export interface SuccessData extends BookingResult {
  name: string;
  mobile: string;
  notes: string;
}

export type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | string;

export interface LookupResult {
  booking_code: string;
  status: BookingStatus;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  estimated_amount: number | string | null;
  customer_name: string;
  resource_name: string;
}

export interface Contact {
  name: string;
  mobile: string;
}
