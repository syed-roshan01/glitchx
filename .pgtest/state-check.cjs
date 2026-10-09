/* Current station + live session state */
const SUPA_URL = 'https://vfonvktaqurwfapkgfuz.supabase.co';
const SERVICE = process.env.SERVICE_KEY;

async function main() {
  const resources = await (await fetch(
    `${SUPA_URL}/rest/v1/resources?select=id,name,type,status,current_status,active&order=name`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  )).json();
  console.log('resources:');
  for (const r of resources) {
    console.log(`  ${r.name.padEnd(12)} type=${r.type.padEnd(12)} status=${r.status.padEnd(9)} current=${r.current_status.padEnd(11)} active=${r.active}`);
  }
  const live = await (await fetch(
    `${SUPA_URL}/rest/v1/sessions?select=id,status,resource_id,actual_start_time,scheduled_start_time,created_at&status=in.(ACTIVE,PAUSED,SCHEDULED)&order=created_at.desc`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
  )).json();
  console.log(`\nlive/scheduled sessions (${live.length}):`);
  for (const s of live) {
    console.log(`  ${s.created_at.slice(0, 19)} ${String(s.status).padEnd(9)} res=${s.resource_id.slice(0, 8)} start=${String(s.actual_start_time).slice(0, 19)} sched=${String(s.scheduled_start_time).slice(0, 19)} id=${s.id.slice(0, 8)}`);
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
