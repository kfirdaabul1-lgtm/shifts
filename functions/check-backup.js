// Runs from the deploy workflow: checks that the Drive backup endpoint answers (never prints the key or the data).
// If Google blocks it before our code (no public invoker), grants allUsers the invoker role on driveBackup and tries again.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
const URL = 'https://europe-west1-hotel-shifts.cloudfunctions.net/driveBackup';
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 300)}`);
async function call(key) { const r = await fetch(URL + '?key=' + encodeURIComponent(key)); const b = await r.text(); return { s: r.status, len: b.length, head: b.slice(0, 80) }; }
async function grant(fn = 'driveBackup') {
  const cred = admin.credential.applicationDefault(); const { access_token: t } = await cred.getAccessToken();
  const base = 'https://cloudfunctions.googleapis.com/v1/projects/hotel-shifts/locations/europe-west1/functions/' + fn;
  const pol = await (await fetch(base + ':getIamPolicy', { headers: { Authorization: 'Bearer ' + t } })).json();
  if (pol.error) return 'getIamPolicy: ' + pol.error.message;
  const b = (pol.bindings || []).find((x) => x.role === 'roles/cloudfunctions.invoker');
  if (b && (b.members || []).includes('allUsers')) return 'already public';
  const bindings = (pol.bindings || []).filter((x) => x.role !== 'roles/cloudfunctions.invoker').concat([{ role: 'roles/cloudfunctions.invoker', members: [...new Set([...(b ? b.members : []), 'allUsers'])] }]);
  const r = await (await fetch(base + ':setIamPolicy', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ policy: { ...pol, bindings } }) })).json();
  return r.error ? 'setIamPolicy: ' + r.error.message : 'made public';
}
(async () => {
  const d = await db.doc('backupcfg/main').get(), c = d.exists ? d.data() : {};
  note('Backup cfg', `key ${c.key ? 'set (' + String(c.key).length + ' chars)' : 'MISSING'} · lastAt ${c.lastAt ? new Date(c.lastAt).toISOString() : 'never'} · createdAt ${c.createdAt ? new Date(c.createdAt).toISOString() : '-'}`);
  let r = await call('wrong-key-check');
  note('Backup probe', `status ${r.s} · ${r.head.replace(/<[^>]+>/g, ' ').trim().slice(0, 60)}`);
  if (r.s !== 403 || r.head.trim() !== 'forbidden') { note('Backup invoker', await grant().catch((e) => 'grant failed: ' + e.message)); await new Promise((x) => setTimeout(x, 20000)); r = await call('wrong-key-check'); note('Backup probe 2', `status ${r.s} · ${r.head.replace(/<[^>]+>/g, ' ').trim().slice(0, 60)}`); }
  // WhatsApp webhook must be public too (Meta calls it); without the verify token it answers our own 403 "forbidden"
  const W = 'https://europe-west1-hotel-shifts.cloudfunctions.net/waWebhook';
  let w = await fetch(W).then(async (x) => ({ s: x.status, b: (await x.text()).slice(0, 60) })).catch((e) => ({ s: 0, b: e.message }));
  note('WhatsApp probe', `status ${w.s} · ${w.b.replace(/<[^>]+>/g, ' ').trim()}`);
  if (w.s !== 403 || w.b.trim() !== 'forbidden') { note('WhatsApp invoker', await grant('waWebhook').catch((e) => 'grant failed: ' + e.message)); await new Promise((x) => setTimeout(x, 20000)); w = await fetch(W).then(async (x) => ({ s: x.status, b: (await x.text()).slice(0, 60) })).catch((e) => ({ s: 0, b: e.message })); note('WhatsApp probe 2', `status ${w.s} · ${w.b.replace(/<[^>]+>/g, ' ').trim()}`); }
  // no real call here: a real call would update lastAt and hide a broken Apps Script schedule
})().catch((e) => { note('Backup check error', e.message); });
