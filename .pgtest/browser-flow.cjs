/* Reproduce the user's exact flow in a real browser (system Chrome):
   login → new session → start → watch the timer tick on the detail page.
   Captures console errors, page errors, and screenshots. */
const { chromium } = require('playwright-core');
const fs = require('fs');

const APP = process.env.APP_URL || 'http://localhost:3000';
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;
const EMAIL = `browser-${Date.now()}@cafe.test`;
const PASSWORD = 'Browser#2026!x';

async function main() {
  // temp user
  const createRes = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });
  const created = await createRes.json();
  let sessionId = null;
  const consoleErrors = [];
  const pageErrors = [];

  try {
    await new Promise((r) => setTimeout(r, 1200));
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ active: true }),
    });

    // connect to an externally-launched Chrome (CDP over WebSocket avoids sandboxed spawn)
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const context = browser.contexts()[0] ?? (await browser.newContext({ viewport: { width: 1280, height: 900 } }));
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));

    // 1 — login
    await page.goto(`${APP}/admin/login`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.fill('input[type=email]', EMAIL);
    await page.fill('input[type=password]', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL('**/admin**', { timeout: 60000 });
    console.log('login: OK →', page.url());

    // 2 — new session page
    await page.goto(`${APP}/admin/sessions/new`, { waitUntil: 'networkidle', timeout: 60000 });
    // pick the first free (non-busy) station card
    const freeCard = page.locator('section[aria-label=Stations] button:not(:has-text(Busy)):not(:has-text(Maintenance))').first();
    await freeCard.click();
    await page.waitForTimeout(600);
    // ensure a duration option is set (default is applied automatically) → Start
    const startBtn = page.locator('button:has-text("Start")').last();
    const btnText = await startBtn.textContent().catch(() => '?');
    console.log('start button text:', (btnText || '').trim());
    await startBtn.click();
    console.log('clicked start — waiting for navigation to session page…');

    // 3 — land on /admin/sessions/[id]
    await page.waitForURL('**/admin/sessions/*', { timeout: 90000 });
    sessionId = page.url().split('/').pop();
    console.log('session page:', sessionId.slice(0, 8));
    await page.waitForTimeout(4000); // let it render + tick

    const readTimer = async (label) => {
      const elapsed = await page.locator('text=Elapsed time').locator('..').locator('p.font-mono').textContent().catch(() => 'NOT FOUND');
      console.log(`${label}: elapsed shows "${(elapsed || '').trim()}"`);
    };
    await readTimer('t+0s');
    await page.waitForTimeout(5000);
    await readTimer('t+5s');
    await page.screenshot({ path: '.pgtest/timer-detail.png' });

    // 4 — dashboard timer
    await page.goto(`${APP}/admin`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3500);
    const card = await page.locator('text=Elapsed').first().isVisible().catch(() => false);
    if (card) {
      const v1 = await page.locator('.font-mono').first().textContent().catch(() => '?');
      await page.waitForTimeout(4000);
      const v2 = await page.locator('.font-mono').first().textContent().catch(() => '?');
      console.log(`dashboard timer: "${(v1 || '').trim()}" → "${(v2 || '').trim()}"`);
    } else {
      console.log('dashboard: no elapsed card visible');
    }
    await page.screenshot({ path: '.pgtest/timer-dashboard.png' });

    // 5 — pause + resume via UI
    await page.goto(`${APP}/admin/sessions/${sessionId}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    const pauseBtn = page.locator('button:has-text("Pause")').first();
    if (await pauseBtn.isVisible().catch(() => false)) {
      await pauseBtn.click();
      await page.waitForTimeout(2500);
      await readTimer('after pause');
      const resumeBtn = page.locator('button:has-text("Resume")').first();
      if (await resumeBtn.isVisible().catch(() => false)) {
        await resumeBtn.click();
        await page.waitForTimeout(3000);
        await readTimer('after resume');
      } else {
        console.log('⚠️ no Resume button visible after pausing!');
        await page.screenshot({ path: '.pgtest/timer-paused.png' });
      }
    } else {
      console.log('no Pause button visible on detail page');
    }

    await browser.close(); // closes the CDP connection; Chrome process is killed by the launcher
  } finally {
    // cleanup: end session if still live
    try {
      if (sessionId) {
        const ANON = process.env.ANON_KEY;
        const session = await (await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json();
        const res = await fetch(`${APP}/api/admin/sessions/${sessionId}/end`, {
          method: 'POST',
          headers: { cookie: `sb-vfonvktaqurwfapkgfuz-auth-token=${JSON.stringify(session)}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentMethod: 'CASH', billing: { duration_seconds: 60, gaming_amount: 100 } }),
        });
        console.log('cleanup end session:', res.status);
      }
    } catch (e) { console.log('cleanup session: ', e.message); }
    await fetch(`${SUPA_URL}/rest/v1/profiles?id=eq.${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    await fetch(`${SUPA_URL}/auth/v1/admin/users/${created.id}`, { method: 'DELETE', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    console.log('temp user cleaned up');
  }

  console.log('\nconsole errors:', consoleErrors.length ? consoleErrors : 'none');
  console.log('page errors:', pageErrors.length ? pageErrors : 'none');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
