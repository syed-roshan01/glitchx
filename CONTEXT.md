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
| Schema | ⚠️ **00014 written but NOT yet applied to live** — run `supabase/migrations/00014_security_payments_booking.sql` in the SQL Editor. 13 migrations applied (combined in [`supabase/setup.sql`](supabase/setup.sql); reset via [`supabase/reset.sql`](supabase/reset.sql)). Seed: PS5 ₹100/hr (+2h pkg ₹180), Pool ₹300/hr (+30min ₹150), Coke ₹40, Water ₹20, Chips ₹30, Extra Controller ₹50. |
| Keys | All in `.env.local` (gitignored — never commit; rotate if leaked). Vercel has **3 env vars** (URL, anon, service_role). `NEXT_PUBLIC_APP_URL` deliberately NOT set — the booking QR falls back to the request origin, so it auto-tracks the domain. |
| Custom domain | Not connected yet. When added in Vercel → Settings → Domains, QR + everything follows automatically. |

## 3. Repo state (latest commits on `main`)

| Commit | What |
|---|---|
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

## 9. Known issues / pending

1. **Apply 00014 to live Supabase** (SQL Editor) and redeploy — security fixes and
   the new booking/payment RPCs depend on it. Then review `profiles` for any
   unknown self-signed-up accounts and deactivate them. Optionally disable
   "Allow new users to sign up" in Supabase Auth settings after setup.
2. **Admin account status unconfirmed** — user was told to complete
   `/admin/setup`; never explicitly confirmed. Check: dashboard → does login work /
   `public_setup_status` → `needs_admin`.
3. Custom domain + printed QR not done yet (QR auto-tracks origin once domain is added).
4. Optional: pg_cron for `activate_due_sessions` (currently lazy on page loads — fine
   for one cafe); WhatsApp/SMS waitlist notifications; logo upload to Supabase Storage.
5. `next.config.mjs` carries `workerThreads: true` + `NEXT_DISABLE_BUILD_WORKER`
   opt-in — safe, documented in README §6 note.

## 10. Next-session quick start

```powershell
cd C:\Users\toros\Pictures\glitchx
node scripts/dev-server.cjs          # dev server (in-sandbox; or `npm run dev`)
npm run verify:schema                # if SQL changed
npm test && npm run typecheck        # if TS changed
```

Checklist when resuming: read this file top-to-bottom → check
`git log --oneline -5` → check live deploy → update §8/§9 before ending the session.
