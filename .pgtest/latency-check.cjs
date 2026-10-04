/* Measure round-trip latency to the live Supabase project */
const URL_BASE = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const ANON = process.env.ANON_KEY;

async function timed(label, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`${label}: ${Date.now() - t0} ms`);
  } catch (e) {
    console.log(`${label}: FAILED after ${Date.now() - t0} ms — ${e.message}`);
  }
}

async function main() {
  // 3x RPC (typical of what each admin page triggers)
  for (let i = 1; i <= 3; i++) {
    await timed(`rpc public_setup_status #${i}`, () =>
      fetch(`${URL_BASE}/rest/v1/rpc/public_setup_status`, {
        method: 'POST',
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
        body: '{}',
      }).then((r) => r.json())
    );
  }
  // auth endpoint (what getUser hits)
  await timed('auth /user (unauthed — measures RTT)', () =>
    fetch(`${URL_BASE}/auth/v1/user`, { headers: { apikey: ANON } }).then((r) => r.json())
  );
}
main();
