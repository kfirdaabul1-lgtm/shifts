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
  try { const w = (await db.doc('wacfg/main').get()).data() || {}; note('WhatsApp security', `provider ${w.provider || 'meta'} · appSecret ${w.appSecret ? 'set' : 'MISSING (unsigned webhook POSTs are accepted)'}`); } catch (e) { note('WhatsApp security', 'read failed: ' + e.message); }
  // WhatsApp webhook must be public too (Meta calls it); without the verify token it answers our own 403 "forbidden"
  const W = 'https://europe-west1-hotel-shifts.cloudfunctions.net/waWebhook';
  let w = await fetch(W).then(async (x) => ({ s: x.status, b: (await x.text()).slice(0, 60) })).catch((e) => ({ s: 0, b: e.message }));
  note('WhatsApp probe', `status ${w.s} · ${w.b.replace(/<[^>]+>/g, ' ').trim()}`);
  if (w.s !== 403 || w.b.trim() !== 'forbidden') { note('WhatsApp invoker', await grant('waWebhook').catch((e) => 'grant failed: ' + e.message)); await new Promise((x) => setTimeout(x, 20000)); w = await fetch(W).then(async (x) => ({ s: x.status, b: (await x.text()).slice(0, 60) })).catch((e) => ({ s: 0, b: e.message })); note('WhatsApp probe 2', `status ${w.s} · ${w.b.replace(/<[^>]+>/g, ' ').trim()}`); }
  // spa online booking endpoint must be public (the booking page calls it)
  const SP = 'https://europe-west1-hotel-shifts.cloudfunctions.net/spaPublic';
  let sp = await fetch(SP).then((x) => x.status).catch(() => 0); note('Spa booking probe', 'status ' + sp);
  if (sp !== 200) { note('Spa booking invoker', await grant('spaPublic').catch((e) => 'grant failed: ' + e.message)); await new Promise((x) => setTimeout(x, 20000)); sp = await fetch(SP).then((x) => x.status).catch(() => 0); note('Spa booking probe 2', 'status ' + sp); }
  // login lockout endpoint must be public (the login page calls it); our own code answers GET with 405 "method"
  const PG = 'https://europe-west1-hotel-shifts.cloudfunctions.net/pwGuard';
  const pgProbe = () => fetch(PG).then(async (x) => ({ s: x.status, b: (await x.text()).slice(0, 40) })).catch((e) => ({ s: 0, b: e.message }));
  let pg = await pgProbe(); note('Login guard probe', 'status ' + pg.s);
  if (pg.s !== 405 || pg.b.trim() !== 'method') { note('Login guard invoker', await grant('pwGuard').catch((e) => 'grant failed: ' + e.message)); await new Promise((x) => setTimeout(x, 20000)); pg = await pgProbe(); note('Login guard probe 2', 'status ' + pg.s + ' · ' + pg.b.replace(/<[^>]+>/g, ' ').trim()); }
  // group guide page endpoint must be public (guide.html calls it); without a key our own code answers 404 {"error":"notfound"}
  const GG = 'https://europe-west1-hotel-shifts.cloudfunctions.net/grpGuide';
  const ggProbe = () => fetch(GG).then(async (x) => ({ s: x.status, b: (await x.text()).slice(0, 40) })).catch((e) => ({ s: 0, b: e.message }));
  let gg = await ggProbe(); note('Group guide probe', 'status ' + gg.s);
  if (gg.s !== 404 || gg.b.indexOf('notfound') < 0) { note('Group guide invoker', await grant('grpGuide').catch((e) => 'grant failed: ' + e.message)); await new Promise((x) => setTimeout(x, 20000)); gg = await ggProbe(); note('Group guide probe 2', 'status ' + gg.s + ' · ' + gg.b); }
  // price comparison endpoint must be public (the owner's price agent calls it with its key); GET answers our own 405 "method"
  const RI = 'https://europe-west1-hotel-shifts.cloudfunctions.net/ratesIngest';
  const riProbe = () => fetch(RI).then(async (x) => ({ s: x.status, b: (await x.text()).slice(0, 40) })).catch((e) => ({ s: 0, b: e.message }));
  let ri = await riProbe(); note('Rates probe', 'status ' + ri.s);
  if (ri.s !== 405 || ri.b.trim() !== 'method') { note('Rates invoker', await grant('ratesIngest').catch((e) => 'grant failed: ' + e.message)); await new Promise((x) => setTimeout(x, 20000)); ri = await riProbe(); note('Rates probe 2', 'status ' + ri.s + ' · ' + ri.b.replace(/<[^>]+>/g, ' ').trim()); }
  // Arsona e-mail endpoint must be public (the owner's Apps Script calls it with its key); GET answers our own 405 "method"
  const AM = 'https://europe-west1-hotel-shifts.cloudfunctions.net/arsonaMail';
  const amProbe = () => fetch(AM).then(async (x) => ({ s: x.status, b: (await x.text()).slice(0, 40) })).catch((e) => ({ s: 0, b: e.message }));
  let am = await amProbe(); note('Arsona mail probe', 'status ' + am.s);
  if (am.s !== 405 || am.b.trim() !== 'method') { note('Arsona mail invoker', await grant('arsonaMail').catch((e) => 'grant failed: ' + e.message)); await new Promise((x) => setTimeout(x, 20000)); am = await amProbe(); note('Arsona mail probe 2', 'status ' + am.s); }
  // PMS booking mails endpoint must be public too (the owner's Apps Script calls it with its key); GET answers our own 405 "method"
  const BI = 'https://europe-west1-hotel-shifts.cloudfunctions.net/bookingsIngest';
  const biProbe = () => fetch(BI).then(async (x) => ({ s: x.status, b: (await x.text()).slice(0, 40) })).catch((e) => ({ s: 0, b: e.message }));
  let bi = await biProbe(); note('Bookings probe', 'status ' + bi.s);
  if (bi.s !== 405 || bi.b.trim() !== 'method') { note('Bookings invoker', await grant('bookingsIngest').catch((e) => 'grant failed: ' + e.message)); await new Promise((x) => setTimeout(x, 20000)); bi = await biProbe(); note('Bookings probe 2', 'status ' + bi.s); }
  // Optima Agent endpoint must be public too (the Windows agent calls it with a per-hotel key); GET answers our own 405 {"error":"method"}
  const OI = 'https://europe-west1-hotel-shifts.cloudfunctions.net/optimaIngest';
  const oiProbe = () => fetch(OI).then(async (x) => ({ s: x.status, b: (await x.text()).slice(0, 40) })).catch((e) => ({ s: 0, b: e.message }));
  let oi = await oiProbe(); note('Optima probe', 'status ' + oi.s);
  if (oi.s !== 405 || !/method/.test(oi.b)) { note('Optima invoker', await grant('optimaIngest').catch((e) => 'grant failed: ' + e.message)); await new Promise((x) => setTimeout(x, 20000)); oi = await oiProbe(); note('Optima probe 2', 'status ' + oi.s); }
  // no real call here: a real call would update lastAt and hide a broken Apps Script schedule
})().catch((e) => { note('Backup check error', e.message); });
