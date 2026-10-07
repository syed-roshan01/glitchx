// ============================================================
// Row mappers — convert Postgres rows (numerics arrive as
// strings) into typed domain objects with JS numbers.
// ============================================================

import type {
  Booking, CafeSettings, Customer, Invoice, InvoiceItem, MenuItem, Payment,
  PricingPlan, PricingRule, Profile, Resource, ServiceItem, Session,
  SessionItem, WaitlistEntry, LedgerEntry,
} from '@/types';
import { num } from '@/lib/billing/format';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function mapProfile(r: any): Profile {
  return { ...r };
}

export function mapCustomer(r: any): Customer {
  return { ...r };
}

export function mapPricingPlan(r: any): PricingPlan {
  return {
    ...r,
    price: num(r.price),
    duration_minutes: r.duration_minutes ?? null,
  };
}

export function mapPricingRule(r: any): PricingRule {
  return {
    ...r,
    price: num(r.price),
    days_of_week: r.days_of_week ?? [0, 1, 2, 3, 4, 5, 6],
  };
}

export function mapResource(r: any): Resource {
  return { ...r };
}

export function mapMenuItem(r: any): MenuItem {
  return {
    ...r,
    price: num(r.price),
    cost_price: r.cost_price === null ? null : num(r.cost_price),
    stock: r.stock === null ? null : Number(r.stock),
  };
}

export function mapServiceItem(r: any): ServiceItem {
  return { ...r, price: num(r.price) };
}

export function mapSession(r: any): Session {
  return {
    ...r,
    guest_name: r.guest_name ?? null,
    guest_mobile: r.guest_mobile ?? null,
    // linked customer first, then the typed walk-in details; null = "Walk-in"
    customer_name: r.customer_name ?? r.guest_name ?? null,
    customer_mobile: r.customer_mobile ?? r.guest_mobile ?? null,
    total_paused_seconds: r.total_paused_seconds ?? 0,
    pricing_plan_snapshot: r.pricing_plan_snapshot ?? {},
    gaming_amount: r.gaming_amount === null ? null : num(r.gaming_amount),
    discount_value: r.discount_value === null ? null : num(r.discount_value),
    discount_amount: r.discount_amount === null ? null : num(r.discount_amount),
    tax_amount: r.tax_amount === null ? null : num(r.tax_amount),
    subtotal: r.subtotal === null ? null : num(r.subtotal),
    total_amount: r.total_amount === null ? null : num(r.total_amount),
  };
}

export function mapSessionItem(r: any): SessionItem {
  return {
    ...r,
    unit_price: num(r.unit_price),
    total_price: num(r.total_price),
  };
}

export function mapBooking(r: any): Booking {
  return { ...r, estimated_amount: r.estimated_amount === null ? null : num(r.estimated_amount) };
}

export function mapWaitlist(r: any): WaitlistEntry {
  return { ...r };
}

export function mapInvoice(r: any): Invoice {
  return {
    ...r,
    gaming_amount: num(r.gaming_amount),
    items_amount: num(r.items_amount),
    services_amount: num(r.services_amount),
    discount_amount: num(r.discount_amount),
    discount_value: r.discount_value === null ? null : num(r.discount_value),
    tax_rate: r.tax_rate === null ? null : num(r.tax_rate),
    tax_amount: num(r.tax_amount),
    subtotal: num(r.subtotal),
    total_amount: num(r.total_amount),
  };
}

export function mapInvoiceItem(r: any): InvoiceItem {
  return {
    ...r,
    unit_price: num(r.unit_price),
    total_price: num(r.total_price),
  };
}

export function mapPayment(r: any): Payment {
  return { ...r, amount: num(r.amount) };
}

export function mapSettings(r: any): CafeSettings {
  return {
    ...r,
    tax_rate: r.tax_rate === null ? null : num(r.tax_rate),
  };
}

export function mapLedgerEntry(r: any): LedgerEntry {
  return {
    id: r.id,
    entry_type: r.entry_type,
    category: r.category,
    amount: num(r.amount),
    entry_date: r.entry_date,
    payment_method: r.payment_method ?? null,
    description: r.description ?? null,
    created_by: r.created_by ?? null,
    created_by_name: r.created_by_name ?? null,
    created_at: r.created_at,
  };
}
