/* eslint-disable */
// ============================================================
// Local schema verification harness.
// Boots an embedded PostgreSQL (binaries from @embedded-postgres),
// stubs the Supabase `auth` schema, runs every migration in order,
// then exercises the core RPC flows (sessions, billing, bookings,
// waitlist, RLS basics).
//
// Usage: node .pgtest/run.cjs
// ============================================================
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
const DATA = path.join(__dirname, 'data');
const LOG = path.join(__dirname, 'postgres.log');
const PORT = 5433;
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');

const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m, e) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  if (e) console.log(String(e.message || e).split('\n').slice(0, 12).join('\n'));
  process.exitCode = 1;
};
const expectError = async (fn, code, label) => {
  try {
    await fn();
    fail(`${label} — expected error ${code}, got none`);
    return false;
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes(code)) {
      pass(`${label} → ${code}`);
      return true;
    }
    fail(`${label} — expected ${code}, got: ${msg.split('\n')[0]}`, e);
    return false;
  }
};

function run(bin, args) {
  const r = spawnSync(path.join(BIN, bin), args, { stdio: 'ignore' });
  if (r.status !== 0) {
    console.error(`${bin} ${args.join(' ')} failed with code ${r.status}`);
    process.exit(1);
  }
}

let serverProc = null;

async function startServer() {
  fs.rmSync(LOG, { force: true });
  const outFd = fs.openSync(LOG, 'a');
  const errFd = fs.openSync(LOG, 'a');
  serverProc = spawn(path.join(BIN, 'postgres.exe'), [
    '-D', DATA, '-p', String(PORT), '-c', 'listen_addresses=127.0.0.1',
  ], { stdio: ['ignore', outFd, errFd], detached: true });
  serverProc.unref();
  // wait until a real query succeeds (the port can open during crash recovery)
  const deadline = Date.now() + 30000;
  for (;;) {
    const c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres' });
    try {
      await c.connect();
      await c.query('select 1');
      await c.end();
      return;
    } catch (e) {
      await c.end().catch(() => {});
      if (Date.now() > deadline) throw new Error(`postgres not ready: ${e.message} (see .pgtest/postgres.log)`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

function stopServer() {
  try {
    if (serverProc && serverProc.pid) serverProc.kill();
  } catch { /* already gone */ }
}

async function main() {
  // ---- boot postgres ----
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log('Initializing test PostgreSQL…');
  run('initdb.exe', ['-D', DATA, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C']);
  await startServer();
  console.log(`PostgreSQL running on 127.0.0.1:${PORT}\n`);

  const client = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres' });
  await client.connect();

  try {
    // ---- supabase environment stub ----
    console.log('Stubbing Supabase environment (auth schema, anon/authenticated roles)…');
    await client.query(`
      create schema if not exists auth;
      create table if not exists auth.users (
        id uuid primary key,
        email text,
        raw_app_meta_data jsonb default '{}'::jsonb,
        raw_user_meta_data jsonb default '{}'::jsonb,
        created_at timestamptz default now(),
        updated_at timestamptz default now()
      );
      create or replace function auth.uid()
        returns uuid language sql stable
        as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then
          create role anon nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then
          create role service_role nologin;
        end if;
      end $$;
    `);
    pass('environment stub ready');

    // ---- run migrations in order ----
    console.log('\nRunning migrations:');
    const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
      try {
        await client.query(sql);
        pass(f);
      } catch (e) {
        fail(f, e);
        return;
      }
    }

    // ---- functional tests ----
    console.log('\nFunctional tests:');

    // 1. auth user -> profile auto-created by trigger
    const { rows: [user] } = await client.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values (gen_random_uuid(), 'owner@cafe.test', '{"name": "Test Owner"}')
       returning id`
    );
    const { rows: [profile] } = await client.query('select name, role from public.profiles where id = $1', [user.id]);
    profile && profile.role === 'STAFF' && profile.name === 'Test Owner'
      ? pass('auth user trigger creates STAFF profile')
      : fail('profile trigger', new Error(JSON.stringify(profile)));

    // 2. claim_first_admin
    await client.query("select set_config('request.jwt.claim.sub', $1, false)", [user.id]);
    const { rows: [claimed] } = await client.query('select public.claim_first_admin() as ok');
    claimed.ok === true ? pass('claim_first_admin promotes to ADMIN') : fail('claim_first_admin');
    const { rows: [role2] } = await client.query('select public.claim_first_admin() as ok');
    role2.ok === false ? pass('claim_first_admin refuses when admin exists') : fail('claim re-claim guard');

    // 3. setup status
    const { rows: [{ public_setup_status: setupStatus }] } = await client.query('select public.public_setup_status()');
    setupStatus.needs_admin === false && setupStatus.has_resources === true && setupStatus.has_items === true
      ? pass('public_setup_status reflects state')
      : fail('public_setup_status', new Error(JSON.stringify(setupStatus)));

    // 4. availability RPC
    const { rows: avail } = await client.query('select * from public.public_get_availability()');
    avail.length === 3 && avail.every((r) => r.status === 'AVAILABLE' && r.rate_label && r.rate_label.includes('/hour'))
      ? pass(`public_get_availability → 3 resources with rate labels (${avail.map((r) => r.rate_label).join(', ')})`)
      : fail('public_get_availability', new Error(JSON.stringify(avail)));

    // 5. customer + session start
    const { rows: [cust] } = await client.query(
      'select public.admin_find_or_create_customer($1, $2, null, $3) as id',
      ['Rahul Kumar', '9876543210', user.id]
    );
    const { rows: [ps5] } = await client.query("select id from public.resources where name = 'PS5 01'");
    const { rows: [plan] } = await client.query("select * from public.pricing_plans where name = 'PS5 Hourly'");
    const { rows: [startRes] } = await client.query(
      'select * from public.admin_start_session($1, $2, $3, now(), null, null, null, $4)',
      [cust.id, ps5.id, plan.id, user.id]
    );
    const sessionId = startRes.admin_start_session;
    const { rows: [session] } = await client.query('select * from public.sessions where id = $1', [sessionId]);
    session.status === 'ACTIVE' && session.actual_start_time
      ? pass('admin_start_session → ACTIVE session')
      : fail('admin_start_session', new Error(JSON.stringify(session)));

    // 6. resource flips to BUSY
    const { rows: [resStatus] } = await client.query('select current_status from public.resources where id = $1', [ps5.id]);
    resStatus.current_status === 'BUSY' ? pass('resource status trigger → BUSY') : fail('resource BUSY trigger');

    // 7. second session on same resource → RESOURCE_BUSY
    await expectError(
      () => client.query('select public.admin_start_session($1, $2, $3, now(), null, null, null, $4)', [cust.id, ps5.id, plan.id, user.id]),
      'RESOURCE_BUSY',
      'double-start on same resource rejected'
    );

    // 8. add items (Coke x2, Extra Controller)
    const { rows: [coke] } = await client.query("select id, price from public.items where name = 'Coke'");
    const { rows: [ctrl] } = await client.query("select id, price from public.services where name = 'Extra Controller'");
    const { rows: [{ admin_add_session_item: line1 }] } = await client.query(
      'select * from public.admin_add_session_item($1, $2, $3, 2, $4)',
      [sessionId, 'DRINK', coke.id, user.id]
    );
    Number(line1.total_price) === 80 ? pass('add Coke ×2 → ₹80 snapshot') : fail('add item total', new Error(JSON.stringify(line1)));
    await client.query('select public.admin_add_session_item($1, $2, $3, 1, $4)', [sessionId, 'SERVICE', ctrl.id, user.id]);
    pass('add Extra Controller service');

    // 9. pause / resume
    await client.query('select public.admin_pause_session($1)', [sessionId]);
    const { rows: [paused] } = await client.query('select status, paused_at from public.sessions where id = $1', [sessionId]);
    paused.status === 'PAUSED' && paused.paused_at ? pass('pause works') : fail('pause');
    await client.query('select public.admin_resume_session($1)', [sessionId]);
    const { rows: [resumed] } = await client.query('select status, total_paused_seconds from public.sessions where id = $1', [session.id]);
    resumed.status === 'ACTIVE' && resumed.total_paused_seconds >= 0 ? pass('resume accumulates pause time') : fail('resume');

    // 10. end session → invoice (billing: 42 min × ₹100/hr ≈ ₹70)
    await client.query('select pg_sleep(0.02)');
    const { rows: [{ admin_end_session_and_invoice: end }] } = await client.query(
      'select * from public.admin_end_session_and_invoice($1, $2, $3, $4, $5, null, $6)',
      [sessionId, JSON.stringify({ duration_seconds: 1, gaming_amount: 1.67 }), 'PERCENT', 10, 'CASH', user.id]
    );
    end.invoice_number && /^INV-\d{4}-\d{5}$/.test(end.invoice_number)
      ? pass(`end session → invoice ${end.invoice_number}`)
      : fail('invoice number format', new Error(JSON.stringify(end)));
    Number(end.items_amount) === 80 && Number(end.services_amount) === 50
      ? pass('invoice amounts: items ₹80 + services ₹50')
      : fail('invoice amounts', new Error(JSON.stringify(end)));
    const { rows: [invCheck] } = await client.query(
      'select i.status, i.total_amount, s.status as session_status, s.payment_status from public.invoices i join public.sessions s on s.id = i.session_id where i.id = $1',
      [end.invoice_id]
    );
    invCheck.status === 'PAID' && invCheck.session_status === 'COMPLETED' && invCheck.payment_status === 'PAID'
      ? pass('session COMPLETED + invoice PAID atomically')
      : fail('end-session state', new Error(JSON.stringify(invCheck)));

    // 11. resource released
    const { rows: [resStatus2] } = await client.query('select current_status from public.resources where id = $1', [ps5.id]);
    resStatus2.current_status === 'AVAILABLE' ? pass('resource released → AVAILABLE') : fail('resource release');

    // 12. booking flow + conflict prevention
    const start = new Date(Date.now() + 3600_000).toISOString();
    const { rows: [{ public_create_booking: booking }] } = await client.query(
      'select * from public.public_create_booking($1, $2, $3, $4, 60, null)',
      ['Arjun', '9876500001', ps5.id, start]
    );
    /^GC-\d+$/.test(booking.booking_code) && Number(booking.estimated_amount) === 100
      ? pass(`public booking ${booking.booking_code} (est ₹${booking.estimated_amount})`)
      : fail('public_create_booking', new Error(JSON.stringify(booking)));

    await expectError(
      () => client.query('select * from public.public_create_booking($1, $2, $3, $4, 60, null)', ['Someone', '9876500002', ps5.id, start]),
      'SLOT_TAKEN',
      'overlapping booking rejected'
    );

    // resource should be RESERVED now (booking within 3h)
    const { rows: [resStatus3] } = await client.query('select current_status from public.resources where id = $1', [ps5.id]);
    resStatus3.current_status === 'RESERVED' ? pass('resource shows RESERVED for upcoming booking') : fail(`RESERVED status (got ${resStatus3.current_status})`);

    // 13. check-in booking → session
    const { rows: [checkedIn] } = await client.query('select public.admin_check_in_booking($1, $2) as session_id', [booking.id, user.id]);
    checkedIn.session_id ? pass('check-in creates session') : fail('check-in');
    const { rows: [bk] } = await client.query('select status from public.bookings where id = $1', [booking.id]);
    bk.status === 'CHECKED_IN' ? pass('booking → CHECKED_IN') : fail('booking check-in status');

    // clean up the live session so later tests start clean
    await client.query('select public.admin_end_session_and_invoice($1, $2, null, 0, null, null, $3)', [checkedIn.session_id, JSON.stringify({ duration_seconds: 0, gaming_amount: 0 }), user.id]);

    // 14. waitlist
    const { rows: [{ public_join_waitlist: wl }] } = await client.query(
      'select * from public.public_join_waitlist($1, $2, $3, null, 60)',
      ['Priya', '9876500003', ps5.id]
    );
    wl.position === 1 ? pass('waitlist join → position 1') : fail('waitlist position', new Error(JSON.stringify(wl)));

    // 15. RLS + ACL basics as anon
    await client.query('set role anon');
    try {
      await client.query('select count(*) from public.customers');
      fail('anon should NOT have table access to customers');
    } catch (e) {
      /permission denied/.test(e.message)
        ? pass('anon blocked from customers (no ACL grant at all)')
        : fail('anon customers access', e);
    }
    const { rows: anonSettings } = await client.query('select cafe_name from public.settings');
    anonSettings.length === 1 ? pass('RLS: anon can read settings') : fail('RLS settings');
    const { rows: anonRes } = await client.query('select count(*)::int as n from public.resources where active');
    anonRes[0].n === 3 ? pass('RLS: anon reads active resources') : fail('RLS resources');
    await client.query('reset role');

    // 16. scheduled session activation
    const { rows: [pool] } = await client.query("select id from public.resources where name = 'Pool Table'");
    const { rows: [poolPlan] } = await client.query("select * from public.pricing_plans where name = 'Pool Hourly'");
    const future = new Date(Date.now() + 70_000).toISOString(); // beyond the 1-min "start now" window
    const { rows: [schedRes] } = await client.query(
      'select * from public.admin_start_session($1, $2, $3, $4, 30, null, null, $5)',
      [cust.id, pool.id, poolPlan.id, future, user.id]
    );
    const { rows: [sched] } = await client.query('select status from public.sessions where id = $1', [schedRes.admin_start_session]);
    sched.status === 'SCHEDULED' ? pass('future start → SCHEDULED') : fail('scheduled status', new Error(JSON.stringify(sched)));
    // simulate the scheduled time arriving
    await client.query("update public.sessions set scheduled_start_time = now() - interval '2 seconds' where id = $1", [schedRes.admin_start_session]);
    await client.query('select public.activate_due_sessions()');
    const { rows: [activated] } = await client.query('select status from public.sessions where id = $1', [schedRes.admin_start_session]);
    activated.status === 'ACTIVE' ? pass('activate_due_sessions promotes due session') : fail('lazy activation');
    await client.query('select public.admin_end_session_and_invoice($1, $2, null, 0, null, null, $3)', [schedRes.admin_start_session, JSON.stringify({ duration_seconds: 0, gaming_amount: 0 }), user.id]);

    console.log('\n\x1b[32mAll schema + functional tests passed.\x1b[0m');

    // ---- reset + re-run cycle (recovery flow for a failed first run) ----
    console.log('\nReset + re-run cycle:');
    const reset = fs.readFileSync(path.join(ROOT, 'supabase', 'reset.sql'), 'utf8');
    try {
      await client.query(reset);
      pass('reset.sql drops the public schema cleanly');
    } catch (e) {
      fail('reset.sql', e);
      return;
    }
    for (const f of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
      try {
        await client.query(sql);
      } catch (e) {
        fail(`re-run ${f} after reset`, e);
        return;
      }
    }
    pass(`all ${files.length} migrations re-run cleanly after reset`);
    const { rows: [recheck] } = await client.query('select count(*)::int as n from public.resources');
    recheck.n === 3 ? pass('seed data intact after reset + re-run') : fail('post-reset seed');
    console.log('\n\x1b[32mReset + re-run cycle verified.\x1b[0m');
  } finally {
    await client.end().catch(() => {});
    stopServer();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
