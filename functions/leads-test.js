// Live test of the leads/events split (Nov 19): temporary users/roles/docs ztest_* (removed at the end). Prints PASS/FAIL and counts only.
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore(), P = 'hotel-shifts', KEY = 'AIzaSyAvI0CfZXIiiNql51SYTdGJT7XdPbWUOaA';
const NJ = ['events', 'rooms', 'spa', 'bride', ''];
const BASE = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' · ' + extra : '')); };
async function tok(uid) {
  const ct = await admin.auth().createCustomToken(uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: ct, returnSecureToken: true }) });
  const j = await r.json(); if (!j.idToken) throw new Error('sign-in failed ' + r.status); return j.idToken;
}
const val = (v) => Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
async function query(t, coll, filters) {
  const f = filters.map(([field, op, v]) => ({ fieldFilter: { field: { fieldPath: field }, op, value: val(v) } }));
  const where = !f.length ? undefined : f.length === 1 ? f[0] : { compositeFilter: { op: 'AND', filters: f } };
  const r = await fetch(`${BASE}:runQuery`, { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: coll }], ...(where ? { where } : {}), limit: 50 } }) });
  return r.ok;
}
async function get(t, path) { const r = await fetch(`${BASE}/${path}`, { headers: { authorization: 'Bearer ' + t } }); return r.status; }
async function create(t, coll, id, fields) {
  const fl = {}; for (const [k, v] of Object.entries(fields)) fl[k] = val(v);
  const r = await fetch(`${BASE}/${coll}?documentId=${id}`, { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ fields: fl }) });
  return r.status;
}
const U = { E: 'ztest_ev_only', L: 'ztest_leads_only', M: 'ztest_mkt_only' };
(async () => {
  try {
    const now = Date.now();
    await db.doc('roles/' + U.E).set({ apps: { events: true }, hotels: [], name: 'ztest' });
    await db.doc('roles/' + U.L).set({ apps: { leads: true }, hotels: [], name: 'ztest' });
    await db.doc('roles/' + U.M).set({ apps: { mkt: true }, hotels: [], name: 'ztest' });
    await db.doc('leads/ztest_e1').set({ name: 'ztest', cat: 'events', venue: 'sola', stage: 'new', createdAt: now, source: 'other' });
    await db.doc('quotes/ztest_q1').set({ kind: 'group', status: 'draft', event: { venue: 'sola', date: '2030-01-01' }, client: { name: 'ztest' }, createdAt: now });
    await db.doc('waChats/972500000000').set({ name: 'ztest', phone: '0500000000', venue: '', agent: '', leadId: '', createdAt: now });
    await db.doc('tasks/ztest_t1').set({ title: 'ztest', venue: '', owner: '', createdBy: 'x', createdAt: now });
    const T = {}; for (const [k, u] of Object.entries(U)) T[k] = await tok(u);
    // events only: quotes yes, leads page data no
    ok('events-only reads a quote', (await get(T.E, 'quotes/ztest_q1')) === 200);
    ok('events-only lists quotes of a venue', await query(T.E, 'quotes', [['event.venue', 'EQUAL', 'sola']]));
    ok('events-only lead list refused', !(await query(T.E, 'leads', [['cat', 'IN', NJ]])));
    ok('events-only lead get refused', (await get(T.E, 'leads/ztest_e1')) === 403);
    ok('events-only WhatsApp chat refused', (await get(T.E, 'waChats/972500000000')) === 403);
    ok('events-only task refused', (await get(T.E, 'tasks/ztest_t1')) === 403);
    ok('events-only reads wapub (quote WhatsApp template)', [200, 404].includes(await get(T.E, 'wapub/main')));
    // leads only: leads yes, quotes no
    ok('leads-only lists leads', await query(T.L, 'leads', [['cat', 'IN', NJ]]));
    ok('leads-only reads a lead', (await get(T.L, 'leads/ztest_e1')) === 200);
    ok('leads-only reads a WhatsApp chat', (await get(T.L, 'waChats/972500000000')) === 200);
    ok('leads-only reads a task', (await get(T.L, 'tasks/ztest_t1')) === 200);
    ok('leads-only creates a task', (await create(T.L, 'tasks', 'ztest_t2', { title: 'ztest', venue: '', owner: U.L, createdBy: U.L, createdAt: now })) === 200);
    ok('leads-only quote get refused', (await get(T.L, 'quotes/ztest_q1')) === 403);
    ok('leads-only quote list refused', !(await query(T.L, 'quotes', [['event.venue', 'EQUAL', 'sola']])));
    // social media only: no leads page data
    ok('mkt-only WhatsApp chat refused', (await get(T.M, 'waChats/972500000000')) === 403);
    ok('mkt-only task refused', (await get(T.M, 'tasks/ztest_t1')) === 403);
    ok('mkt-only lead create refused', (await create(T.M, 'leads', 'ztest_c1', { name: 'ztest', cat: 'events', venue: 'sola' })) === 403);
    ok('mkt-only quote refused', (await get(T.M, 'quotes/ztest_q1')) === 403);
    // migration: every real role / job role with events also has leads
    let miss = 0, n = 0; (await db.collection('roles').get()).forEach((d) => { if (d.id.startsWith('ztest')) return; const a = (d.data() || {}).apps || {}; if (a.events) { n++; if (!a.leads) miss++; } });
    let jm = 0; (await db.collection('jobRoles').get()).forEach((d) => { const a = (d.data() || {}).apps || {}; if (a.events && !a.leads) jm++; });
    ok('every role with events also has leads', miss === 0 && jm === 0, `${n} roles with events, missing ${miss}, job roles missing ${jm}`);
  } catch (e) { fail++; console.log('ERROR ' + String(e.message || e).slice(0, 200)); }
  finally {
    for (const p of ['leads/ztest_e1', 'leads/ztest_c1', 'quotes/ztest_q1', 'waChats/972500000000', 'tasks/ztest_t1', 'tasks/ztest_t2']) await db.doc(p).delete().catch(() => {});
    for (const u of Object.values(U)) { await db.doc('roles/' + u).delete().catch(() => {}); await admin.auth().deleteUser(u).catch(() => {}); }
    console.log(`::notice title=Leads split test::${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
