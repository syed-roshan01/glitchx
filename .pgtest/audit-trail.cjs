/* Who paused the session? Check audit logs + session updates */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;

async function main() {
  const logs = await (await fetch(
    `${SUPA_URL}/rest/v1/audit_logs?select=action,entity_id,created_at,user_id,metadata&entity_type=eq.session&order=created_at.desc&limit=20`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  )).json();
  console.log(`recent session audit entries (${logs.length}):`);
  for (const l of logs) {
    console.log(`  ${l.created_at.slice(0, 19)}  ${String(l.action).padEnd(18)} session=${String(l.entity_id).slice(0, 8)} by=${String(l.user_id).slice(0, 8)} ${JSON.stringify(l.metadata ?? {})}`.slice(0, 150));
  }

  // also check profiles to map user ids to names
  const profiles = await (await fetch(
    `${SUPA_URL}/rest/v1/profiles?select=id,name,role,active`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  )).json();
  console.log('\nprofiles:');
  for (const p of profiles) {
    console.log(`  ${p.id.slice(0, 8)}  ${String(p.role).padEnd(7)} active=${p.active}  ${p.name}`);
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
