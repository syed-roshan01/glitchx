# Testing Guide — Gaming Cafe System

## Automated tests

```bash
npm test              # 26 billing-engine unit tests (Node built-in runner)
npm run verify:schema # full schema + functional tests against an embedded
                      # PostgreSQL (no Supabase project required)
```

**Billing unit tests** cover: rounding modes (exact/15/30/60), minimum billing, peak-rule
matching (timezone-correct, specificity order, resource scoping), hourly/per-minute/package/fixed
pricing, pause time exclusion, booking estimates, end-to-end bills with fixed & percentage
discounts, tax on the discounted amount, and discount capping.

**Schema verification** (`.pgtest/run.cjs`) boots an embedded PostgreSQL 18, stubs the
Supabase `auth` schema (`auth.users`, `auth.uid()`, anon/authenticated/service_role roles),
runs all 13 migrations as single-transaction scripts — exactly like the SQL Editor — and
then executes 29 functional checks:

- auth-user trigger creates a STAFF profile; `claim_first_admin` promotes and refuses re-claims
- `public_get_availability()` returns seeded rates (`₹ 100.00/hour`, `₹ 300.00/hour`)
- session lifecycle: start (ACTIVE), resource → BUSY, second start rejected (`RESOURCE_BUSY`),
  add Coke ×2 (₹80 snapshot) and a service, pause/resume with pause-time accumulation,
  end → `INV-2026-00001` with items ₹80 + services ₹50, session COMPLETED + invoice PAID
  atomically, resource released
- public booking `GC-1000` (estimate ₹100), overlapping booking rejected (`SLOT_TAKEN`),
  resource flips to RESERVED, check-in creates the session, waitlist position 1
- ACL/RLS: anon has **no table access** to customers (permission denied), can read settings
  and active resources only
- future start → SCHEDULED, `activate_due_sessions()` promotes due sessions
- `reset.sql` + full migration re-run cycle works (recovery from a failed first run)

Build verification: `npm run build` compiles, type-checks and statically generates all
pages and API routes.

## Manual test plan (30 scenarios)

Run these against a dev server connected to a fresh Supabase project (migrations applied).
Expected results assume the default seed (PS5 ₹100/hr, Pool ₹300/hr, Coke ₹40 …).

### Sessions & billing

| # | Scenario | Expected |
|---|---|---|
| 1 | Start a PS5 session (New Session → customer → PS5 01 → Start now → PS5 Hourly) | Session card appears with live timer; PS5 01 shows BUSY on /book |
| 2 | Start a Pool session on Pool Table | Same; two live sessions run in parallel |
| 3 | Try to start a second session on the same PS5 | Error “This station already has a running session” (DB unique index) |
| 4 | With both PS5s busy, try a third PS5 session | PS5 01/02 are not selectable (grayed out, “Busy”) |
| 5 | Refresh the active session page | Timer continues from the correct value (DB timestamps, not a client counter) |
| 6 | Wait ~2 minutes, then End Session | Duration ≈ 2 min billed per the rounding mode (round-up-15 → 15 min → ₹25 at ₹100/hr… actually ₹25/15min → verify against mode) |
| 7 | Pause a session for 5 minutes, resume, end | Paused time is NOT billed; elapsed excludes it |
| 8 | Add Coke ×2 and Chips ×1 to an active session | Line items show with snapshots: Coke ×2 ₹80, Chips ₹30 |
| 9 | Add “Extra Controller” service | Appears under games/services, ₹50 |
| 10 | End session with 10% discount, tax off | Invoice shows gaming + items + services − discount = total |
| 11 | Enable GST 18% in Settings, end another session | Tax = 18% of (subtotal − discount) |
| 12 | Change Coke’s price to ₹50 after an invoice exists | The old invoice still shows ₹40 (snapshot) |
| 13 | Record payment: Cash / UPI | Invoice status → PAID; payment appears in Payments page |
| 14 | Pay later (no method at end), then record payment from the invoice page | Invoice ISSUED → PAID |

### Bookings & public page

| # | Scenario | Expected |
|---|---|---|
| 15 | Open `/book` (or scan QR) in a phone browser | Live availability grid with rates; no login needed |
| 16 | Book an available PS5 (choose slot + duration) | Confirmation screen with `GC-####` code; booking appears in Admin → Bookings as PENDING (QR source) |
| 17 | Try to book an overlapping slot for the same resource | Rejected: “That time slot is already booked” (exclusion constraint, race-safe) |
| 18 | Cancel the booking from admin | Slot becomes bookable again |
| 19 | Create a future booking, then Check In | Session starts immediately; booking → CHECKED_IN |
| 20 | With all stations busy on /book, join the waitlist | “You are #N in the queue”; entry appears on the dashboard |
| 21 | Assign the waitlist entry from Admin → Bookings | New Session flow opens pre-filled with that customer |
| 22 | Set a resource to maintenance | Public page shows MAINTENANCE; blocked while a session runs |
| 23 | Open /book in a second browser; start a session from admin | The first browser flips to BUSY **without refresh** (realtime) |

### Customers

| # | Scenario | Expected |
|---|---|---|
| 24 | Add a customer; search by partial mobile (“98765”) | Customer found instantly (indexed mobile) |
| 25 | Open the customer profile | Total sessions, total spent, last visit, favorite station, history |

### Pricing & permissions

| # | Scenario | Expected |
|---|---|---|
| 26 | Create a peak rule 18:00–23:00 ₹150/hr for PLAYSTATION; start a session at 8 PM | Current amount accrues at ₹150/hr; invoice shows the peak rate |
| 27 | Create a package plan (2 h ₹180); start a 90-min session | Gaming charge = ₹180 flat |
| 28 | Sign in as STAFF; open Settings / Pricing / staff pages | Access denied (403 / hidden nav); sessions & billing still work |
| 29 | As STAFF, try `curl -X PUT .../api/admin/settings` | 403 Insufficient permissions |
| 30 | Try `curl` to an admin API without a session | 401 Not authenticated |

### Double-check security

```bash
# Unauthenticated API access is rejected
curl -i http://localhost:3000/api/admin/dashboard        # → 401
curl -i http://localhost:3000/api/admin/customers        # → 401
```

In Supabase Studio, confirm RLS: the `anon` role cannot select from `customers`,
`sessions`, `invoices` (run a query in the SQL editor while logged out of the studio
session, or inspect policies).

## Verify invoice immutability (regression check)

1. End a session with Coke ×2 (₹40 each) → note the invoice total.
2. Change Coke’s price to ₹50, change the PS5 plan to ₹120/hr, enable GST 18%.
3. Reopen the old invoice — amounts and lines are unchanged (snapshots).
4. New sessions use the new prices.
