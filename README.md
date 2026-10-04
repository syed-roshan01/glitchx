# GlitchX — Gaming Cafe Management & Booking System

A complete, production-ready management system for a gaming cafe: **live availability, QR-code
booking, walk-in sessions with automatic time-based billing, items & services, invoices,
payments, waitlist and reports** — built for a cafe with 2× PS5 and a pool table, and designed
to scale to any number or type of stations.

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Backend | Supabase — PostgreSQL, Auth, Realtime (no separate Node server) |
| Validation | Zod (server-side on every mutation) |
| Hosting | Frontend → Vercel · Database/Auth/Realtime → Supabase |

---

## 1. What was built

### Customer experience (public, no account, mobile-first)
- **`/book`** — live availability of every station (AVAILABLE / BUSY / RESERVED / MAINTENANCE)
  with rates (`₹100/hour`), updating **in real time** via Supabase Realtime (no refresh).
- **Booking flow**: pick day → 30-min slot grid → duration (30 m / 1 h / 1.5 h / 2 h / 3 h / custom)
  → name + mobile → live price estimate → confirm → booking code (`GC-1024`).
- **Double-booking is impossible** — enforced by a PostgreSQL exclusion constraint.
- **Waitlist**: when everything is busy, customers join a queue and see “You are #3 in the queue.”
- Busy stations show “Started 8:15 PM · expected until 9:15 PM”; reserved ones show the next
  free time and offer to book right after.

### Staff/admin experience (`/admin`)
- **First-time setup wizard** (`/admin/setup`): create the owner account (no hardcoded
  credentials), cafe info, resources, pricing, items, staff, then print the QR.
- **Dashboard**: today's revenue, active sessions, customers, bookings, waitlist count,
  live resource cards, active session cards with **live timers & current bill**, queue,
  bookings and revenue breakdown — all realtime.
- **New Session in < 15 seconds**: search customer by name/mobile (or 2-field quick create) →
  tap an available station → *Start now / +5 min / +10 min / custom* → pick plan → **Start**.
- **Live session management**: running timer (from DB timestamps — survives refresh),
  current gaming charge, add food/drinks (searchable, quantity cart, stock-aware),
  add games/services, pause/resume (configurable), discount (% or fixed), notes.
- **End session** → confirmation screen with the full breakdown → one click creates the
  invoice, records the payment and releases the resource — **in a single DB transaction**.
- **Bookings**: confirm / check-in (starts the session) / cancel / no-show, reschedule,
  new booking modal. Public (QR) bookings are flagged.
- **Waitlist**: positions auto-maintained; *Assign* opens the New Session flow pre-filled.
- **Customers**: search, add, profiles with total sessions/spend, last visit, favorite
  station, session & invoice history.
- **Resources**: add/edit/disable any station type (PS5, PC, Pool, VR, snooker, …),
  maintenance mode, per-resource default plan.
- **Items** (food/drinks with optional inventory tracking) and **Games & Services**
  (extra controller, tournaments, …) with price snapshots on every bill line.
- **Pricing**: plans (hourly / per-minute / fixed / package) + **peak-hour rules**
  (e.g. 6–11 PM ₹150/hr) scoped globally, per type or per resource, with day-of-week.
- **Invoices**: sequential numbers (`INV-2026-00001`), **A4 and 80 mm thermal print
  layouts**, print/PDF via the browser, share link, record payments (incl. partial),
  payment status tracking.
- **Payments**: ledger with method breakdown (Cash/UPI/Card/Other).
- **Reports**: today / week / 30 days — revenue chart, sessions chart, category totals,
  revenue by resource, top items, payment method split, averages, utilization.
- **Settings**: cafe profile (name/address/phone/GSTIN), currency, timezone, invoice
  prefix, tax (on/off, name, %), **billing mode** (exact minutes / round to 15/30/60),
  minimum billing, pause toggle, public-bookings & waitlist toggles, booking window,
  **booking QR** (download/print — stable URL, never changes), staff & roles.
- **Roles**: `ADMIN` (everything), `MANAGER`, `STAFF` (no settings, pricing, staff
  management or deletes of important records) — extensible role list.
- **Audit log** of sensitive actions (who started/ended sessions, changed prices,
  applied discounts, …).

### Billing engine (single source of truth)
All billing math lives in [`lib/billing/engine.ts`](lib/billing/engine.ts) — pure functions used
by both the live UI (timer/current amount) and the server when ending a session. The final
invoice arithmetic is re-computed inside the `admin_end_session_and_invoice` SQL transaction,
which locks the session and validates the duration from **database timestamps**.

Supported: per-minute prorating, round-up modes (15/30/60 min), minimum billing, packages
(flat up to N minutes + prorated extra), fixed pricing, peak-hour overrides, pause exclusion,
% and fixed discounts, configurable tax. **Historical invoices never change** — prices and
rules are snapshotted per session/invoice line.

---

## 2. Database schema summary

Migrations live in [`supabase/migrations/`](supabase/migrations/) (13 files, run in order). The whole set is also pre-combined into [`supabase/setup.sql`](supabase/setup.sql) for a one-paste install, and is **verified end-to-end against real PostgreSQL** by `npm run verify:schema` (boots an embedded PostgreSQL, runs every migration, then exercises sessions, billing, bookings, waitlist, RLS and the reset → re-run cycle).

| Table | Purpose | Key details |
|---|---|---|
| `profiles` | Staff accounts & roles | 1:1 with `auth.users`; trigger auto-creates; roles ADMIN/MANAGER/STAFF |
| `settings` | Single-row cafe config | tax, billing mode, toggles, branding, timezone |
| `customers` | Customer directory | unique mobile (indexed), staff-only access |
| `resources` | Stations | admin `status` + trigger-maintained `current_status` (AVAILABLE/BUSY/RESERVED/MAINTENANCE) |
| `pricing_plans` | Rate cards per resource type | HOURLY / PER_MINUTE / FIXED / PACKAGE |
| `pricing_rules` | Peak-hour overrides | scoped global/type/resource, days + time window, priority |
| `services` | Extra games/services | priced, snapshotted on use |
| `items` | Food & drinks | category, optional stock tracking |
| `sessions` | Play sessions | timing (start/pause/end), plan snapshot, status, final amounts |
| `session_items` | Session line items | name/price **snapshots** |
| `bookings` | Reservations | human code `GC-####`, source PUBLIC/ADMIN, status flow |
| `waitlist` | Queue | auto-assigned positions, status transitions |
| `invoices` | Final bills | sequential number, immutable amounts |
| `invoice_items` | Invoice lines | copied snapshots |
| `payments` | Payment records | method, reference, receiver |
| `audit_logs` | Admin action trail | service-role written only |

**Integrity & race-safety (database-enforced):**
- One live session per resource — partial **unique index** on `sessions(resource_id) WHERE status IN ('ACTIVE','PAUSED')`.
- No overlapping bookings — **GiST exclusion constraint** on `bookings` (btree_gist).
- No overlapping scheduled sessions — exclusion constraint on `sessions`.
- Sequential invoice numbers via sequence + trigger (unique).

**Key functions (`00010_functions.sql`):**
- `public_get_availability()` — safe availability for the QR page (anon-callable).
- `public_create_booking(…)` / `public_join_waitlist(…)` — validated public writes.
- `claim_first_admin()` — one-time onboarding, race-safe via advisory lock.
- `admin_start_session`, `admin_check_in_booking`, `admin_add_session_item`
  (price snapshot + stock decrement), `admin_pause/resume_session`,
  `admin_set_session_discount`, `admin_end_session_and_invoice`
  (the atomic billing transaction), `admin_create/reschedule/update_booking`.
- `refresh_resource_status()` — trigger-maintained derived availability.
- `activate_due_sessions()` — SCHEDULED → ACTIVE at the right moment (called on page
  loads; optionally schedule with pg_cron — snippet in the migration).

**RLS everywhere:** anon can only read active resources/plans/settings and call the three
public RPCs; staff get operational CRUD; admin-only for pricing, settings, staff and
deletes; admin functions are `REVOKE`d from anon/authenticated and called only from
Next.js route handlers with the service-role key. Migration `00013_grants.sql` restates
the anon/authenticated/service_role table grants explicitly (instead of relying on
Supabase default privileges) so realtime subscriptions and the public page work on any
setup.

**Realtime** enabled for `resources`, `sessions`, `session_items`, `bookings`, `waitlist`, `invoices`.

---

## 3. Environment variables

Copy `.env.example` → `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key     # server only — never expose
NEXT_PUBLIC_APP_URL=http://localhost:3000           # used for the booking QR
```

Never commit `.env.local`. The service-role key is used exclusively inside
`lib/supabase/admin.ts`, imported only by route handlers/server components.

---

## 4. Supabase setup steps

1. **Create a project** at [supabase.com](https://supabase.com) (pick a region near you).
2. **Run the schema** — either:
   - **One file (easiest)**: open **Dashboard → SQL Editor → New query**, paste the entire
     contents of [`supabase/setup.sql`](supabase/setup.sql) (all 13 migrations pre-combined)
     and click **Run**; or
   - **Supabase CLI**: `supabase link --project-ref YOUR_PROJECT_REF && supabase db push`
     (runs [`supabase/migrations/`](supabase/migrations/) in order), or run the 13 files
     individually in the SQL Editor.
   - **If a previous attempt failed partway**: run [`supabase/reset.sql`](supabase/reset.sql)
     first — it wipes the `public` schema back to a clean state (auth users are untouched) —
     then run `setup.sql`.
3. **Authentication → Providers → Email**: turn **off** “Confirm email” (recommended for
   staff-only auth; you can re-enable it later).
4. **Authentication → URL Configuration**: add your production URL to redirect URLs
   (only needed if you re-enable confirmation).
5. Grab **Project Settings → API** values for the env vars above.

## 5. Local development commands

```bash
npm install
cp .env.example .env.local    # fill in your Supabase values
npm run dev                   # http://localhost:3000
```

Other commands:

```bash
npm run build    # production build
npm start        # serve the production build
npm test         # billing engine unit tests (Node built-in runner)
npm run typecheck
npm run verify:schema  # runs every migration + functional tests against
                       # an embedded PostgreSQL (no Supabase project needed)
```

First run: open `http://localhost:3000/admin/setup` and complete the wizard.

## 6. Vercel deployment steps

1. Push the repo to GitHub/GitLab.
2. [vercel.com](https://vercel.com) → **Add New Project** → import the repo
   (framework auto-detected as Next.js — no build overrides needed).
3. **Environment Variables** (Production + Preview):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL=https://yourdomain.com`.
4. **Deploy**.
5. Open `https://yourdomain.com/admin/setup` and complete the onboarding.
6. Settings → **Booking QR** → download/print → stick it on the counter.
   The QR always points to `NEXT_PUBLIC_APP_URL/book`, so it never changes.

> Note: `next.config.mjs` includes two safe build helpers (`experimental.workerThreads`
> and an opt-in `NEXT_DISABLE_BUILD_WORKER=1` for environments that block child
> processes). Neither affects normal Vercel builds.

## 7. Default seeded data (migration 00012)

| | |
|---|---|
| **Resources** | PS5 01, PS5 02 (PLAYSTATION) · Pool Table (POOL) |
| **Pricing plans** | PS5 ₹100/hr · PS5 2 h package ₹180 · Pool ₹300/hr · Pool 30 min ₹150 |
| **Items** | Coke ₹40 · Pepsi ₹40 · Water ₹20 · Energy Drink ₹100 · Chips ₹30 · Popcorn ₹40 |
| **Services** | Extra Controller ₹50 · Premium Game ₹50 · FIFA Tournament ₹100 · Racing Game ₹100 · VR Game ₹150 |
| **Settings** | INR ₹ · Asia/Kolkata · round-up-to-15-min billing · tax off · public bookings on · waitlist on |

No admin credentials are hardcoded — the first account you create in the setup wizard
becomes ADMIN.

## 8. Testing performed

- **26 unit tests** for the billing engine (Node built-in runner, all passing):
  rounding modes, minimum billing, peak-rule matching incl. timezone correctness and
  specificity, package pricing, pause handling, estimates, end-to-end bill math with
  discounts (fixed & %) and tax, discount capping.
  Run: `npm test`.
- **Full schema verification against real PostgreSQL** (`npm run verify:schema`): boots an
  embedded PostgreSQL 18, stubs the Supabase `auth` schema, runs all 13 migrations, then
  29 functional checks — session lifecycle (start/pause/resume/end), atomic
  invoice+payment creation (`INV-2026-00001`), price snapshots (Coke ×2 → ₹80),
  resource status transitions (AVAILABLE → BUSY → RESERVED → AVAILABLE), double-start
  rejection (`RESOURCE_BUSY`), booking conflict rejection (`SLOT_TAKEN`), booking codes,
  check-in, waitlist positions, lazy scheduled-session activation, anon ACL/RLS blocking,
  and the reset → re-run recovery cycle. All passing.
- **`npm run build`** — full production build: compilation, type checking and static
  generation of all 20 pages + 26 API routes (**passing**).
- **Runtime smoke test** against the production build: `/book`, `/admin/login`,
  `/admin/setup` return 200; unauthenticated `/admin/*` redirects to login via
  middleware; admin APIs return `401 {"error":"Not authenticated"}`.
- **Manual test plan** (30 scenarios incl. double-booking, pause billing, price-change
  immutability, realtime across two browsers, staff permissions): see
  [`TESTING.md`](TESTING.md).

## 9. Remaining configuration required (before go-live)

1. Create the Supabase project and run the migrations (section 4).
2. Complete the setup wizard (admin account, cafe info, resources/prices/menu).
3. Set `NEXT_PUBLIC_APP_URL` to the production domain (affects the QR).
4. Optional: schedule `select public.activate_due_sessions();` every minute with
   **pg_cron** for instant scheduled-session activation (snippet in
   `00010_functions.sql`); without it, activation happens on the next page load.
5. Optional: enable email confirmations, WhatsApp/SMS notifications for the waitlist,
   logo upload (Supabase Storage), and per-resource plan overrides.

---

## Project structure

```
app/
  book/                     # public QR booking page (realtime)
  admin/
    (auth)/login|setup/     # login + first-time onboarding wizard
    (dash)/                 # authenticated shell
      page.tsx              # dashboard
      sessions/ new/ [id]/  # live sessions, fast start, management
      bookings/ customers/ [id]/
      resources/ items/ services/ pricing/
      invoices/ [id]/ payments/ reports/ settings/
  api/admin/…               # 26 route handlers (service-role, role-checked)
components/ ui/ admin/      # design system + admin widgets
lib/
  billing/engine.ts         # THE billing engine (single source of truth)
  billing/format.ts         # money/duration/date formatting
  supabase/                 # browser / server / admin clients + auth helpers
  validations/schemas.ts    # Zod schemas (never trust input)
  mappers.ts utils/         # row mappers, timezones, errors
hooks/                      # useNow (timers), useRealtime (subscriptions)
types/                      # domain types
supabase/migrations/        # 12 SQL migrations (schema, RLS, functions, seed)
tests/                      # billing engine unit tests
```

## Security model (summary)

- All admin mutations go through **server-side route handlers** that authenticate the
  cookie session, authorize the role, and **validate input with Zod**; amounts/prices are
  always computed server-side — the client never sends a price.
- **RLS** on every table; the public booking page can only read availability and call
  three validated `SECURITY DEFINER` functions.
- The **service-role key never reaches the browser**; historical invoices are immutable
  via the API and snapshot every price they depend on.
- Conflict prevention is enforced by **database constraints**, not application code, so
  races cannot create double-bookings or double sessions.
