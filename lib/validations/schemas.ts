// ============================================================
// Zod validation schemas — used in API route handlers.
// Never trust frontend input.
// ============================================================

import { z } from 'zod';

export const mobileSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-()]/g, ''))
  .pipe(z.string().regex(/^\+?\d{7,15}$/, 'Enter a valid mobile number'));

export const customerSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(120),
  mobile: mobileSchema,
  email: z.union([z.string().trim().email('Invalid email'), z.literal(''), z.null()]).optional(),
  notes: z.string().max(500).optional().nullable(),
});

export const quickCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  mobile: mobileSchema,
  email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional(),
});

export const startSessionSchema = z.object({
  customerId: z.string().uuid(),
  resourceId: z.string().uuid(),
  pricingPlanId: z.string().uuid(),
  startTime: z.string().optional().nullable(), // ISO datetime; empty => now
  expectedMinutes: z.number().int().min(15).max(480).optional().nullable(),
  bookingId: z.string().uuid().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const endSessionSchema = z.object({
  discountType: z.enum(['PERCENT', 'FIXED']).optional().nullable(),
  discountValue: z.number().min(0).max(100000).optional().nullable(),
  paymentMethod: z.enum(['CASH', 'UPI', 'CARD', 'OTHER']).optional().nullable(),
  paymentReference: z.string().max(120).optional().nullable(),
});

export const addSessionItemSchema = z.object({
  itemType: z.enum(['FOOD', 'DRINK', 'SERVICE', 'GAME', 'OTHER']),
  catalogId: z.string().uuid(),
  quantity: z.number().int().min(1).max(999).default(1),
});

export const customerUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(120).optional(),
  mobile: mobileSchema.optional(),
  email: z.union([z.string().trim().email('Invalid email'), z.literal(''), z.null()]).optional(),
  notes: z.string().max(500).optional().nullable(),
});

export const setDiscountSchema = z.object({
  discountType: z.enum(['PERCENT', 'FIXED']).nullable(),
  discountValue: z.number().min(0).max(100000),
});

export const adminBookingSchema = z.object({
  customerId: z.string().uuid(),
  resourceId: z.string().uuid(),
  startTime: z.string(),
  durationMinutes: z.number().int().min(15).max(480),
  status: z.enum(['PENDING', 'CONFIRMED']).default('CONFIRMED'),
  notes: z.string().max(500).optional().nullable(),
});

export const publicBookingSchema = z.object({
  name: z.string().trim().min(2).max(120),
  mobile: mobileSchema,
  resourceId: z.string().uuid(),
  startTime: z.string(),
  durationMinutes: z.number().int().min(15).max(480),
  notes: z.string().max(300).optional().nullable(),
});

export const publicWaitlistSchema = z.object({
  name: z.string().trim().min(2).max(120),
  mobile: mobileSchema,
  resourceId: z.string().uuid().optional().nullable(),
  resourceType: z.string().max(40).optional().nullable(),
  durationMinutes: z.number().int().min(15).max(480).optional().nullable(),
});

export const bookingStatusSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'NO_SHOW', 'COMPLETED']),
});

export const rescheduleSchema = z.object({
  startTime: z.string(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
});

export const resourceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.string().trim().min(1).max(40),
  description: z.string().max(300).optional().nullable(),
  status: z.enum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']).default('ACTIVE'),
  defaultPricingPlanId: z.string().uuid().optional().nullable(),
  active: z.boolean().default(true),
});

export const itemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(['DRINK', 'SNACK', 'FOOD', 'OTHER']).default('OTHER'),
  price: z.number().min(0).max(100000),
  costPrice: z.number().min(0).max(100000).optional().nullable(),
  stock: z.number().int().min(0).max(100000).optional().nullable(),
  trackInventory: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const serviceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).optional().nullable(),
  price: z.number().min(0).max(100000),
  billingType: z.enum(['FIXED', 'PER_SESSION', 'HOURLY']).default('FIXED'),
  active: z.boolean().default(true),
});

export const pricingPlanSchema = z.object({
  resourceType: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  billingType: z.enum(['HOURLY', 'FIXED', 'PER_MINUTE', 'PACKAGE']),
  price: z.number().min(0).max(1000000),
  durationMinutes: z.number().int().min(5).max(1440).optional().nullable(),
  active: z.boolean().default(true),
});

export const pricingRuleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  resourceId: z.string().uuid().optional().nullable(),
  resourceType: z.string().max(40).optional().nullable(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  price: z.number().min(0).max(1000000),
  priority: z.number().int().min(0).max(100).default(0),
  active: z.boolean().default(true),
});

export const settingsSchema = z.object({
  cafe_name: z.string().trim().min(1).max(120),
  logo_url: z.string().trim().url().optional().nullable().or(z.literal('')),
  address: z.string().max(300).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  gstin: z.string().max(30).optional().nullable(),
  currency: z.string().trim().min(1).max(8).default('INR'),
  currency_symbol: z.string().trim().min(1).max(4).default('₹'),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown timezone (use an IANA name like Asia/Kolkata)')
    .default('Asia/Kolkata'),
  invoice_prefix: z.string().trim().min(1).max(10).default('INV'),
  tax_enabled: z.boolean().default(false),
  tax_name: z.string().max(40).optional().nullable(),
  tax_rate: z.number().min(0).max(100).optional().nullable(),
  billing_mode: z.enum(['EXACT_MINUTES', 'ROUND_UP_15', 'ROUND_UP_30', 'ROUND_UP_60']),
  min_billing_minutes: z.number().int().min(0).max(240).default(0),
  pause_enabled: z.boolean().default(true),
  allow_public_bookings: z.boolean().default(true),
  waitlist_enabled: z.boolean().default(true),
  booking_max_days_ahead: z.number().int().min(0).max(90).default(7),
});

export const staffCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  role: z.enum(['ADMIN', 'MANAGER', 'STAFF']).default('STAFF'),
});

export const staffUpdateSchema = z.object({
  role: z.enum(['ADMIN', 'MANAGER', 'STAFF']).optional(),
  active: z.boolean().optional(),
  name: z.string().trim().min(2).max(120).optional(),
});

export const paymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().min(0.01).max(10000000),
  paymentMethod: z.enum(['CASH', 'UPI', 'CARD', 'OTHER']),
  transactionReference: z.string().max(120).optional().nullable(),
});
