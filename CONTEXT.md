# GlitchX — Project Context (Living Document)

> **Purpose:** Full session context so any future session (human or AI) can pick up
> exactly where we left off. **Update this file at the end of every working session.**
> Setup/deployment how-to lives in [`README.md`](README.md); this file is current
> *state*, decisions, history, and environment quirks.

---

## 1. TL;DR — current state

- **Product:** Gaming Cafe Management & Booking System (2× PS5 + 1 pool table, extensible).
- **Stack:** Next.js 14.2 (App Router) · TypeScript strict · Tailwind 3.4 · Supabase
  (Postgres, Auth, Realtime) · framer-motion (homepage) · recharts (reports).
- **Status:** Feature-complete, deployed, live. Production build ✓, 26 billing unit
  tests ✓, 29 functional DB tests ✓ (embedded PostgreSQL), perf-optimized.
- **Live:** Vercel **https://glitchx-nu.vercel.app** · Supabase project `vfonvktaqurwfapkgfuz`.
- **Repo:** https://github.com/syed-roshan01/glitchx (`main`). Working dir:
  `C:\Users\toros\Pictures\glitchx`.

## 2. Live infrastructure

| Thing | Value |
|---|---|
| Supabase project ref | `vfonvktaqurwfapkgfuz` → `https://vfonvktaqurwfapkgfuz.supabase.co` |
| Region | **Mumbai (ap-south-1)** — verified 2026-10-06 by mapping the DB host IP against AWS ip-ranges. (Earlier "not Mumbai" note was wrong; the ~100ms RTT was this machine's network.) Vercel functions pinned to `bom1` via `vercel.json` so server↔DB is same-region. |
| Auth | Email/password, staff-only. **"Confirm email" is OFF.** First account via `/admin/setup` becomes ADMIN (claim via `claim_first_admin()`). |
| Billing mode | **`EXACT_MINUTES` (per-minute billing)** — switched 2026-10-09 at the owner's request (was ROUND_UP_15). Bill grows every minute; `min_billing_minutes` = 0. If the DB is ever reset, re-set this in /admin/settings → Billing. |
| Schema | 15 migrations, **all applied to live** (00014 verified present 2026-10-06 by probing its RPCs — `admin_record_payment`, `public_get_busy_slots`, `public_lookup_booking`, `public_cancel_booking`, `mobile_digits` all respond). Combined in [`supabase/setup.sql`](supabase/setup.sql); reset via [`supabase/reset.sql`](supabase/reset.sql). Seed baseline: PS5 ₹100/hr (+2h pkg ₹180), Pool ₹300/hr (+30min ₹150) — **user has since customized live pricing** (e.g. Pool ₹200/hr). |
| Keys | All in `.env.local` (gitignored — never commit; rotate if leaked). Vercel has **3 env vars** (URL, anon, service_role). `NEXT_PUBLIC_APP_URL` deliberately NOT set — the booking QR falls back to the request origin, so it auto-tracks the domain. |
| Custom domain | Not connected yet. When added in Vercel → Settings → Domains, QR + everything follows automatically. |

## 3. Repo state (latest commits on `main`)

| Commit | What |
|---|---|
| `d76db96` | Session 4 reconciliation: verified 00014 applied live + security probes, fixed stale CONTEXT.md notes, gitignored `.claude/` |
| `311072f` | Session 3's own commit of its remaining work ("Security hardening, faster admin panel, redesigned booking flow"), pushed one minute after the accidental sweep |
| `d7ad75a` | ⚠️ **Accidental sweep** — message says "dev-server cache fix" but it actually contains most of session 3's review/fix pass (~71 files: /book rebuild, 00014, use-api caching, vercel.json) that was staged-but-uncommitted when session 4 committed. Work is verified-good; only the message is misleading. Lesson: **never run two AI sessions in this folder simultaneously** — session 3's live edits also corrupted the dev HMR cache and caused a CONTEXT.md write conflict. |
| `814374c` | CONTEXT.md created (living document) |
| `21d758e` | Perf: signed-identity fast-path auth (0 network round-trips in API routes), parallel dashboard/reports queries, cached settings |
| `120edda` | Homepage redesign: arcade HUD aesthetic, framer-motion, Anton + Chakra Petch fonts, glitch effects, marquee, tilt cards |
| `5fcf6b1` | Marketing homepage v1 (later replaced) |
| `3f249a8` | First commit — full app (113 files) |

Git on this machine: user `syed-roshan01` (toroshaninbox1@gmail.com), gh CLI
authenticated, HTTPS remote. Plain `git push` works from a normal terminal.

## 4. Architecture quick map

```
app/page.tsx              marketing homepage (client, framer-motion, live data)
app/book/                 public QR booking page (anon client + SECURITY DEFINER RPCs + realtime)
app/admin/(auth)/         login + first-run setup wizard (no shell)
app/admin/(dash)/         authed shell: dashboard, sessions, bookings, customers,
                          resources, items, services, pricing, invoices, payments,
                          reports, settings, staff
app/api/admin/*           26 route handlers — all mutations go through these
                          (Zod validation + service-role client)
middleware.ts             cookie refresh + /admin guard + **mints signed identity**
lib/auth/signed-identity.ts  HMAC identity tokens (Web Crypto, edge+node safe)
lib/supabase/api.ts       requireAuth(): fast path (verify signed header, 0 RTT)
                          with full getUser+profile fallback
lib/supabase/settings-cache.ts  30s settings cache (invalidated on save)
lib/billing/engine.ts     THE billing engine (single source of truth; pure fns)
lib/billing/format.ts     money/duration/clock/date formatting (num() for numerics)
supabase/migrations/      00001-00013 (schema, RLS, RPCs, realtime, grants, seed)
.pgtest/run.cjs           boots embedded PostgreSQL 18, runs migrations + 29
                          functional tests + reset/re-run cycle
```

**Security model:** public page only reads via RPCs; admin writes via API routes
(service role); RLS + explicit grants (00013) everywhere; double-booking prevented by
DB exclusion constraints; invoice prices snapshotted (immutable history).

## 5. Dev environment quirks (this machine / DSH sandbox)

| Task | Command that works here |
|---|---|
| npm install | `npm install --no-audit --no-fund --ignore-scripts --cache "C:\Users\toros\Pictures\glitchx\.npm-cache"` |
| Production build | `node node_modules/next/dist/bin/next build` with `$env:NEXT_DISABLE_BUILD_WORKER='1'` (sandbox blocks child-process spawning; Vercel unaffected) |
| Dev server | `npm run dev` normally; in-sandbox use `node scripts/dev-server.cjs` (in-process, avoids CLI fork). It was **killed at end of last session — restart before use.** |
| Tests | `npm test` (billing, 26) · `npm run verify:schema` (DB, 29 + reset cycle) · `npm run typecheck` |
| git push (in-sandbox) | `git -c http.sslBackend=openssl push` with gh token injected into remote URL temporarily (schannel + credential-helper spawning are blocked). From a normal terminal: plain `git push`. |
| Known noise | `sh.exe couldn't create signal pipe` during push = harmless. `revalidateTag http://localhost:undefined` TypeError during sandbox builds = harmless (build completes; production build serves fine). PowerShell 5.1: `$home` is read-only, no ternary operator, watch TLS 12 for Invoke-RestMethod. |
| Dev-server crash fix | If dev 500s with `__webpack_modules__[moduleId] is not a function` (stale HMR cache after many hot reloads): `Remove-Item -Recurse -Force .next`, restart. Production builds unaffected. |

## 6. Verification toolkit

- `.pgtest/run.cjs` — embedded PostgreSQL 18 (`embedded-postgres` dev dep), stubs
  Supabase `auth` schema, runs all migrations as single transactions (like the SQL
  Editor), then 29 functional checks (session lifecycle, atomic invoice
  `INV-2026-00001`, snapshots, RESOURCE_BUSY/SLOT_TAKEN rejections, waitlist,
  RLS/ACL for anon, lazy activation) + reset→re-run cycle.
- `.pgtest/perf-test.cjs` — creates temp user, signs in, times admin APIs through
  the real middleware (cookie format: plain-JSON `sb-<ref>-auth-token`; ssr also
  accepts `base64-`-prefixed). Latest prod numbers: dashboard ~290ms, customers
  235ms, sessions 188ms, unauth 401 in 28ms.
- `.pgtest/live-check.cjs`, `.pgtest/latency-check.cjs` — live DB checks (keys via
  env vars, never hardcode).

## 7. Branding

- Logo: `components/ui/logo.jpeg` (1536×1024 JPEG, 190KB) — used via
  `components/ui/logo.tsx` (next/image) on: homepage, /book, login, setup, admin
  sidebar, A4 + thermal invoice print layouts. Favicon: `app/icon.jpeg`.
- Fonts (homepage only): Anton (display) + Chakra Petch (HUD labels) via
  `app/fonts.ts` + Tailwind `font-display`/`font-hud`.

## 8. Session log

- **2026-10-04 (session 1):** Built the complete system (migrations, RPCs, billing
  engine, admin console, public booking page, invoices/payments/reports, tests).
  Debugged sandbox build (worker threads), fixed Tailwind CSS-variable opacity
  (`rgb(var(--x)/<alpha-value>)`), verified build + routes.
- **Session 2:** Combined SQL into `supabase/setup.sql`; user ran it, hit
  `sym.symbol` bug → stood up embedded PostgreSQL testing, found + fixed 3 SQL bug
  classes (sym.symbol, `constraint_name` in exception handlers → GET STACKED
  DIAGNOSTICS, `coalesce(new,old)` in triggers → tg_op branching), added
  `00013_grants.sql`, `reset.sql`, `npm run verify:schema`. User's Supabase live +
  schema applied. `.env.local` created with their keys (service role key was pasted
  in chat — rotation suggested).
- **Session 2 (cont.):** First GitHub push (sandbox workarounds). Vercel deploy
  (glitchx-nu.vercel.app) with 3 env vars. Logo integration everywhere. Homepage
  v1 → user feedback "looks AI made" → full redesign (framer-motion, glitch/HUD
  aesthetic, display typography, marquee, tilt cards, count-ups).
- **Session 2 (cont.):** User reported admin slowness → diagnosed ~9 sequential
  Supabase round-trips per page (~100ms RTT each). Shipped perf overhaul: signed
  identity fast path, middleware profile cache, parallel dashboard/reports queries,
  settings cache, direct 401s. Verified end-to-end with temp user against
  production build. Dev server left running (now killed).

- **2026-10-06 (session 3):** Full review + fix pass.
  - Security: admin RPCs were executable by anon (PUBLIC execute grant never revoked)
    → 00014 revokes from PUBLIC. Self-signups now get INACTIVE profiles; `my_role()`
    ignores inactive; `claim_first_admin` activates; staff API activates new staff.
  - New RPCs: `admin_record_payment` (locked, atomic), `public_get_busy_slots`,
    `public_lookup_booking`, `public_cancel_booking`, `mobile_digits`.
  - Perf: middleware uses `auth.getClaims()` (local ES256/JWKS verify, no Auth RTT);
    admin pages use `lib/use-api.ts` (SWR cache) + `useSettings()` from
    `components/admin/admin-context.tsx` instead of fetching /api/admin/dashboard;
    layout uses cached settings; `vercel.json` regions=bom1; router staleTimes.
  - API fixes: lone-admin staff creation 409, payments race, filter injection
    (`searchTerm`), paging (`pageParams`), FK → 409 (`dbErrorStatus`), customer
    PATCH validation, discount validation, reports ADMIN/MANAGER only, tz validation,
    bookings `?date=`, payments `todayTotal`, session GET returns `invoice`.
  - UI fixes: session detail hooks crash, end-session discount sync, stale session
    card items, add-item duplicates, endless skeletons, Today tab, utilization,
    mojibake, setup/login inactive-account handling.
  - /book rebuilt: 4-step flow (station → day/duration/time → details → review),
    cafe-timezone slots from busy intervals, sticky summary, .ics + share, My booking
    lookup/cancel, remembered details. Files under `app/book/_components/`.
  - Tests: DB suite now 41 checks (`npm run verify:schema`); `npm test` script fixed
    for Node 22. A stale dev server (scripts/dev-server.cjs) was found running and
    rewriting `.next` — stop it before `next build`.

- **2026-10-06 (session 4):** Cleanup + reconciliation after discovering session 3 ran
  in parallel in this folder.
  - Dev server crashed with stale-HMR-cache error
    (`__webpack_modules__[moduleId] is not a function` on `/`) → fixed by wiping
    `.next` (fix documented in §5).
  - Discovered commit `d7ad75a` had accidentally swept in session 3's staged work
    under a wrong message (see §3). Ran full verification of the merged state:
    typecheck ✓, billing tests 26/26 ✓, DB suite (incl. 00014) + reset cycle ✓,
    dev server serving ✓.
  - **Verified live DB state empirically** (probes in `.pgtest/probe-00014-fns.cjs`,
    `security-probe.cjs`): 00014 IS fully applied (all five new RPCs respond),
    self-signups create INACTIVE profiles ✓, anon cannot execute admin functions
    (401 permission denied) ✓ — the session-3 note "00014 not applied" was stale.
  - Probe gotcha documented: PostgREST returns **404 for wrong RPC parameter
    names**, which looks identical to "function missing" — verify signatures before
    concluding a migration didn't run.
  - User has customized live pricing (Pool ₹200/hr) → admin account is in active use.

- **2026-10-08 (session 5):** Owner requests.
  - Quick-start sessions: /admin/sessions/new = station grid → editable pre-filled price
    (plan price, e.g. PS5 150 / Pool 200) → Start timer. Customer name/mobile optional;
    addable later on the session page, end-session modal, even after invoicing
    (`admin_set_session_customer` also updates the invoice). `sessions.customer_id`
    nullable + `guest_name`/`guest_mobile`; invoices show "Walk-in".
  - Custom per-session price (`p_custom_price`, snapshot `custom`/`base_price`, peak rules
    never override it) + change mid-session (`admin_set_session_price`).
  - "₹140 instead of ₹150" bug: stored bills were always right (ROUND_UP_15); estimates
    (new-session page, booking fallback, SQL `estimate_booking_amount`) used exact
    minutes (56 min × ₹2.50 = ₹140). All estimates now apply the cafe rounding policy.
    Also fixed: booking check-in picked the CHEAPEST plan of the type (pool → ₹120/30-min
    package) instead of the station's default plan. Mobile lookup ignores formatting.
  - Invoices: PDF (lib/invoice-pdf.ts, jspdf, A4 + 80mm) shared as a FILE via Web Share
    (WhatsApp on phones) or downloaded; admin-only delete (cascades lines + payments).
  - Income & Expenses: `ledger_entries` table, /api/admin/ledger, /admin/finance
    (ADMIN/MANAGER): session income from payments + manual income − expenses = net.
  - Migration 00015 (`00015_quick_sessions_pricing_ledger.sql`). DB suite: 54 checks.
  - Note: DSH Desktop also runs `scripts/dev-server.cjs` in this workspace — it rewrites
    `.next` in dev mode; don't run `next start` from the same folder while it runs.

- **2026-10-09 (session 6):** "Timer isn't starting when created session" — root-caused + fixed.
  - **Root cause (data-verified via audit log):** the user paused a test session on
    PS5 02 (`session.paused` 10 s after creation). A paused session KEEPS holding its
    station (exclusion constraint), so creating a new session on that station failed
    with "This station already has a running session" — which reads as "timer isn't
    starting". Everything server-side was verified correct (session → ACTIVE with
    `actual_start_time`, breakdown computing, pause/resume/end all working, 00015 applied).
  - Fixes shipped (no migration — code only, deploys with the app):
    1. `POST /api/admin/sessions` → **409 + `blockedBy` {id,status}** + actionable
       message when the station is held (paused called out explicitly); the wizard
       shows an inline panel linking straight to that session.
    2. POST now returns the **full session object**; the wizard seeds the detail
       page's `useApi` cache (`seed()` in use-api.ts) → timer renders instantly on
       navigation (no spinner-then-tick gap; matters on Vercel cold starts ~2 s).
    3. **Scheduled sessions auto-activate**: `GET /api/admin/sessions/[id]` runs
       `activate_due_sessions` when the requested session is due; the detail page
       also schedules a one-shot refetch at the due moment while you watch.
    4. "paused for Xm — not billing" hints on dashboard cards + detail page.
  - `lib/api-client.ts`: `ApiError` now carries response body fields (blockedBy…).
  - Verified: typecheck ✓, 26/26 billing tests ✓, live probes for all three fixes ✓
    (`.pgtest/fix-verify.cjs`, `fix23-verify.cjs`, `debug-fix3.cjs` — temp station
    created/removed by the script; user's live data never touched).
  - Dev-server quirk (again): one verification run failed because dev served a
    stale compiled module after edits; re-run passed. Restart the dev server when
    a just-verified behavior fails in dev.
  - Sandbox finding: a real browser CANNOT run here (Chrome/Edge mojo IPC needs
    named pipes → EPERM even with crashpad disabled). Browser-level UI testing is
    out of scope in this environment.
  - State left for the user: the paused session f3ca01b5 still holds **PS5 02**
    (their data — not auto-cleaned). PS5 01 was in MAINTENANCE (user-set).
  - Billing switched to **per-minute (`EXACT_MINUTES`)** at the owner's request
    ("billed by 15 minutes into 4 cycles — I want it live for each minute").
    No code change needed — the mode existed end-to-end (engine, SQL estimates,
    settings UI "Per minute (exact)", end-session flow). Changed via the real
    settings API (admin temp user, `.pgtest/switch-billing.cjs`); verified on
    the user's live running session: 10.6 min → 11 billable min (₹27.50),
    previously 15 min (₹37.50). Takes effect instantly, even mid-session.

## 9. Known issues / pending

1. ~~Apply 00014 to live Supabase~~ **DONE — verified applied 2026-10-06** (session 4
   probes). Still worth reviewing `profiles` for unknown self-signed-up accounts from
   before the hardening (created while the old active-by-default trigger was live),
   and optionally disabling "Allow new users to sign up" in Supabase Auth settings.
2. **Admin account confirmed in use** — user has customized pricing via the admin
   panel (observed 2026-10-06).
3. Custom domain + printed QR not done yet (QR auto-tracks origin once domain is added).
4. Optional: pg_cron for `activate_due_sessions` (now also lazy-activated on session
   detail GETs — good enough for one cafe); WhatsApp/SMS waitlist notifications;
   logo upload to Supabase Storage.
5. `next.config.mjs` carries `workerThreads: true` + `NEXT_DISABLE_BUILD_WORKER`
   opt-in — safe, documented in README §6 note.
6. **Avoid parallel AI sessions in this folder** — see the `d7ad75a` note in §3.
   If it happens anyway: check `git status` before any commit.

## 10. Next-session quick start

```powershell
cd C:\Users\toros\Pictures\glitchx
node scripts/dev-server.cjs          # dev server (in-sandbox; or `npm run dev`)
npm run verify:schema                # if SQL changed
npm test && npm run typecheck        # if TS changed
```

Checklist when resuming: read this file top-to-bottom → check
`git log --oneline -5` → check live deploy → update §8/§9 before ending the session.
