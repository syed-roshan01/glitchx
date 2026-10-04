// ============================================================
// Domain types — shared across the app
// ============================================================

export type Role = 'ADMIN' | 'MANAGER' | 'STAFF';

export type BillingType = 'HOURLY' | 'FIXED' | 'PER_MINUTE' | 'PACKAGE';
export type BillingMode = 'EXACT_MINUTES' | 'ROUND_UP_15' | 'ROUND_UP_30' | 'ROUND_UP_60';

export type ItemCategory = 'DRINK' | 'SNACK' | 'FOOD' | 'OTHER';
export type SessionItemType = 'FOOD' | 'DRINK' | 'SERVICE' | 'GAME' | 'OTHER';
export type InvoiceItemType = SessionItemType | 'GAMING' | 'DISCOUNT';

export type SessionStatus = 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type WaitlistStatus = 'WAITING' | 'NOTIFIED' | 'ASSIGNED' | 'CANCELLED' | 'EXPIRED';
export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'OTHER';
export type InvoiceStatus = 'ISSUED' | 'PARTIAL' | 'PAID' | 'VOID';
export type ResourceBaseStatus = 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
export type ResourceLiveStatus = 'AVAILABLE' | 'BUSY' | 'RESERVED' | 'MAINTENANCE';
export type DiscountType = 'PERCENT' | 'FIXED';

export interface Profile {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerStats {
  total_sessions: number;
  total_spent: number;
  last_visit: string | null;
  favorite_resource: string | null;
}

export interface PricingPlan {
  id: string;
  resource_type: string;
  name: string;
  billing_type: BillingType;
  price: number;
  duration_minutes: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PricingRule {
  id: string;
  name: string;
  resource_id: string | null;
  resource_type: string | null;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  price: number;
  priority: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Resource {
  id: string;
  name: string;
  type: string;
  description: string | null;
  status: ResourceBaseStatus;
  current_status: ResourceLiveStatus;
  default_pricing_plan_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServiceItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  billing_type: 'FIXED' | 'PER_SESSION' | 'HOURLY';
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MenuItem {
  id: string;
  name: string;
  category: ItemCategory;
  price: number;
  cost_price: number | null;
  stock: number | null;
  track_inventory: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanSnapshot {
  name: string;
  billing_type: BillingType;
  price: number;
  duration_minutes: number | null;
}

export interface Session {
  id: string;
  booking_id: string | null;
  customer_id: string;
  resource_id: string;
  pricing_plan_id: string | null;
  pricing_plan_snapshot: PlanSnapshot;
  status: SessionStatus;
  scheduled_start_time: string | null;
  actual_start_time: string | null;
  expected_end_time: string | null;
  end_time: string | null;
  paused_at: string | null;
  total_paused_seconds: number;
  duration_seconds: number | null;
  gaming_amount: number | null;
  discount_type: DiscountType | null;
  discount_value: number | null;
  discount_amount: number | null;
  tax_amount: number | null;
  subtotal: number | null;
  total_amount: number | null;
  payment_status: 'PENDING' | 'PARTIAL' | 'PAID' | 'REFUNDED' | 'WAIVED';
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // joined fields (optional — populated by API)
  customer_name?: string;
  customer_mobile?: string;
  resource_name?: string;
  resource_type?: string;
}

export interface SessionItem {
  id: string;
  session_id: string;
  item_type: SessionItemType;
  item_id: string | null;
  name_snapshot: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  created_by: string | null;
  created_at: string;
}

export interface Booking {
  id: string;
  booking_code: string;
  customer_id: string | null;
  customer_name: string;
  customer_mobile: string;
  resource_id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  status: BookingStatus;
  estimated_amount: number | null;
  source: 'PUBLIC' | 'ADMIN';
  notes: string | null;
  created_at: string;
  updated_at: string;
  // joined fields
  resource_name?: string;
  resource_type?: string;
}

export interface WaitlistEntry {
  id: string;
  customer_id: string | null;
  customer_name: string;
  customer_mobile: string;
  resource_type: string | null;
  resource_id: string | null;
  requested_duration_minutes: number | null;
  position: number;
  status: WaitlistStatus;
  created_at: string;
  updated_at: string;
  served_at: string | null;
  resource_name?: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  session_id: string | null;
  customer_id: string | null;
  customer_name: string;
  customer_mobile: string;
  resource_name: string;
  session_start: string | null;
  session_end: string | null;
  duration_minutes: number | null;
  gaming_amount: number;
  items_amount: number;
  services_amount: number;
  discount_amount: number;
  discount_type: DiscountType | null;
  discount_value: number | null;
  tax_name: string | null;
  tax_rate: number | null;
  tax_amount: number;
  subtotal: number;
  total_amount: number;
  status: InvoiceStatus;
  created_by: string | null;
  issued_at: string;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  item_type: InvoiceItemType;
  name_snapshot: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  sort_order: number;
  created_at: string;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  payment_method: PaymentMethod;
  payment_status: 'PENDING' | 'PAID' | 'REFUNDED';
  transaction_reference: string | null;
  paid_at: string | null;
  received_by: string | null;
  created_at: string;
  received_by_name?: string;
  invoice_number?: string;
}

export interface CafeSettings {
  id: string;
  cafe_name: string;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  currency: string;
  currency_symbol: string;
  timezone: string;
  invoice_prefix: string;
  tax_enabled: boolean;
  tax_name: string | null;
  tax_rate: number | null;
  billing_mode: BillingMode;
  min_billing_minutes: number;
  pause_enabled: boolean;
  allow_public_bookings: boolean;
  waitlist_enabled: boolean;
  booking_max_days_ahead: number;
  setup_completed_at: string | null;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  user_name?: string;
}

// Public availability row (from public_get_availability RPC)
export interface AvailabilityRow {
  resource_id: string;
  name: string;
  resource_type: string;
  status: ResourceLiveStatus;
  hourly_rate: number | null;
  rate_label: string | null;
  plan_name: string | null;
  busy_until: string | null;
  next_booking_start: string | null;
  session_started_at: string | null;
  currency_symbol: string;
}

export interface DashboardStats {
  todayRevenue: number;
  gamingRevenue: number;
  foodRevenue: number;
  serviceRevenue: number;
  activeSessions: number;
  todaySessions: number;
  todayCustomers: number;
  pendingBookings: number;
  waitlistCount: number;
  avgSessionMinutes: number;
  avgBillValue: number;
  utilization: { resourceId: string; name: string; minutes: number; sessions: number }[];
}
