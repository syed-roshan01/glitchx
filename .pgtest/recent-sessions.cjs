/* Inspect recent live sessions to see what state user-created sessions are in */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;

async function main() {
  const res = await fetch(
    `${SUPA_URL}/rest/v1/sessions?select=id,status,actual_start_time,scheduled_start_time,paused_at,total_paused_seconds,expected_end_time,created_at,pricing_plan_snapshot,guest_name,customer_id&order=created_at.desc&limit=12`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  );
  const sessions = await res.json();
  console.log(`last ${sessions.length} sessions:`);
  for (const s of sessions) {
    const plan = s.pricing_plan_snapshot ? `${s.pricing_plan_snapshot.name} ₹${s.pricing_plan_snapshot.price}` : '—';
    console.log(
      `  ${s.created_at.slice(0, 19)}  ${String(s.status).padEnd(9)} start=${String(s.actual_start_time).slice(0, 19)} sched=${String(s.scheduled_start_time).slice(0, 19)}  ${plan}  ${s.guest_name ?? s.customer_id ?? ''}`
    );
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
