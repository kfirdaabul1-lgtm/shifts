// One-off live test of the hiring-leads rules + onLeadCat (Nov 18). Uses temporary test users/roles/leads (ids ztest_*), removes them at the end.
// Prints only pass/fail lines and counts (no lead data).
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore(), P = 'hotel-shifts', KEY = 'AIzaSyAvI0CfZXIiiNql51SYTdGJT7XdPbWUOaA';
const H7 = 'hezj3h4cj', HG = 'h9xtmhzkm', NJ = ['events', 'rooms', 'spa', 'bride', ''];
const BASE = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' · ' + extra : '')); };
async function tok(uid) {
  const ct = await admin.auth().createCustomToken(uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: ct, returnSecureToken: true }) });
  const j = await r.json(); if (!j.idToken) throw new Error('sign-in failed ' + r.status); return j.idToken;
}
const val = (v) => Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : { stringValue: String(v) };
async function query(t, filters) {
  const f = filters.map(([field, op, v]) => ({ fieldFilter: { field: { fieldPath: field }, op, value: val(v) } }));
  const where = !f.length ? undefined : f.length === 1 ? f[0] : { compositeFilter: { op: 'AND', filters: f } };
  const r = await fetch(`${BASE}:runQuery`, { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'leads' }], ...(where ? { where } : {}), limit: 1000 } }) });
  const j = await r.json(); if (!r.ok) return { ok: false, status: r.status, err: (Array.isArray(j) ? j[0] : j).error && (Array.isArray(j) ? j[0] : j).error.status };
  const ids = (Array.isArray(j) ? j : []).filter((x) => x.document).map((x) => x.document.name.split('/').pop());
  return { ok: true, ids };
}
async function get(t, id) { const r = await fetch(`${BASE}/leads/${id}`, { headers: { authorization: 'Bearer ' + t } }); return r.status; }
async function create(t, id, fields) {
  const fl = {}; for (const [k, v] of Object.entries(fields)) fl[k] = val(v);
  const r = await fetch(`${BASE}/leads?documentId=${id}`, { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ fields: fl }) });
  return r.status;
}
const U = { A: 'ztest_jobs_all', B: 'ztest_nojobs_all', C: 'ztest_jobs_7even', D: 'ztest_nojobs_7even' };
const LEADS = ['ztest_j3', 'ztest_j1', 'ztest_j2', 'ztest_e1', 'ztest_t1', 'ztest_t2', 'ztest_c1', 'ztest_c2'];
(async () => {
  try {
    const now = Date.now();
    await db.doc('roles/' + U.A).set({ apps: { events: true }, hotels: [], leadCats: ['jobs', 'events'], name: 'ztest' });
    await db.doc('roles/' + U.B).set({ apps: { events: true }, hotels: [], leadCats: [], name: 'ztest' });
    await db.doc('roles/' + U.C).set({ apps: { events: true }, hotels: [H7], leadCats: ['jobs'], name: 'ztest' });
    await db.doc('roles/' + U.D).set({ apps: { events: true }, hotels: [H7], leadCats: [], name: 'ztest' });
    await db.doc('leads/ztest_j1').set({ name: 'ztest', cat: 'jobs', job: 'חדרנית', jobHotel: H7, venue: '', stage: 'new', createdAt: now, source: 'other' });
    await db.doc('leads/ztest_j2').set({ name: 'ztest', cat: 'jobs', job: 'קבלה', jobHotel: HG, venue: '', stage: 'new', createdAt: now, source: 'other' });
    await db.doc('leads/ztest_e1').set({ name: 'ztest', cat: 'events', venue: 'sola', stage: 'new', createdAt: now, source: 'other' });
    // onLeadCat trigger: leads without cat
    await db.doc('leads/ztest_t1').set({ name: 'ztest', notes: 'דרושה חדרנית למלון', venue: '', stage: 'new', createdAt: now, source: 'other' });
    await db.doc('leads/ztest_t2').set({ name: 'ztest', type: 'אירוע חברה', venue: 'sola', stage: 'new', createdAt: now, source: 'other' });
    const T = {}; for (const [k, u] of Object.entries(U)) T[k] = await tok(u);
    // B: no jobs, all hotels
    let q = await query(T.B, [['cat', 'IN', NJ]]); ok('B (no jobs) lists cat in [non-jobs]', q.ok, q.ok ? '' : q.err);
    ok('B sees no jobs lead in that list', q.ok && !q.ids.includes('ztest_j1') && !q.ids.includes('ztest_j2') && q.ids.includes('ztest_e1'));
    q = await query(T.B, []); ok('B whole collection is refused (or hides jobs)', !q.ok || !q.ids.some((x) => x.startsWith('ztest_j')), q.ok ? 'allowed, rows ' + q.ids.length + ', jobs rows ' + q.ids.filter((x) => x.startsWith('ztest_j')).length : q.err);
    q = await query(T.B, [['cat', 'EQUAL', 'jobs']]); ok('B cat==jobs is refused', !q.ok);
    ok('B get jobs lead refused', (await get(T.B, 'ztest_j1')) === 403);
    ok('B get events lead allowed', (await get(T.B, 'ztest_e1')) === 200);
    ok('B create jobs lead refused', (await create(T.B, 'ztest_c1', { name: 'ztest', cat: 'jobs', jobHotel: '', venue: '' })) === 403);
    // A: jobs, all hotels
    q = await query(T.A, [['cat', 'EQUAL', 'jobs']]); ok('A (jobs) lists cat==jobs', q.ok, q.ok ? '' : q.err);
    ok('A sees both jobs leads', q.ok && q.ids.includes('ztest_j1') && q.ids.includes('ztest_j2'));
    q = await query(T.A, [['cat', 'IN', NJ]]); ok('A also lists non-jobs', q.ok);
    ok('A get jobs lead allowed', (await get(T.A, 'ztest_j2')) === 200);
    ok('A create jobs lead allowed', (await create(T.A, 'ztest_c2', { name: 'ztest', cat: 'jobs', jobHotel: '', venue: '' })) === 200);
    // C: jobs, 7EVEN only
    q = await query(T.C, [['cat', 'EQUAL', 'jobs'], ['jobHotel', 'IN', [H7, '']]]); ok('C (jobs, 7EVEN) lists its jobs', q.ok, q.ok ? '' : q.err);
    ok('C sees 7EVEN jobs lead, not Gutman', q.ok && q.ids.includes('ztest_j1') && !q.ids.includes('ztest_j2'));
    q = await query(T.C, [['cat', 'EQUAL', 'jobs']]); ok('C all jobs (no hotel filter) refused or hides Gutman', !q.ok || !q.ids.includes('ztest_j2'), q.ok ? 'allowed, rows ' + q.ids.length + ', has Gutman ' + q.ids.includes('ztest_j2') : q.err);
    ok('C get Gutman jobs lead refused', (await get(T.C, 'ztest_j2')) === 403);
    // D: no jobs, 7EVEN
    q = await query(T.D, [['cat', 'IN', NJ], ['venue', 'EQUAL', 'sola']]); ok('D (no jobs, 7EVEN) lists its venue', q.ok, q.ok ? '' : q.err);
    ok('D sees the sola events lead', q.ok && q.ids.includes('ztest_e1'));
    q = await query(T.D, [['venue', 'EQUAL', 'sola']]); ok('D venue-only query refused or hides jobs', !q.ok || !q.ids.some((x) => x.startsWith('ztest_j')), q.ok ? 'allowed, rows ' + q.ids.length : q.err);
    await db.doc('leads/ztest_j3').set({ name: 'ztest', cat: 'jobs', jobHotel: '', venue: 'sola', stage: 'new', createdAt: Date.now(), source: 'other' });
    q = await query(T.D, [['venue', 'EQUAL', 'sola']]); ok('D venue-only query with a sola jobs lead: refused or hidden', !q.ok || !q.ids.includes('ztest_j3'), q.ok ? 'allowed, rows ' + q.ids.length + ', has jobs ' + q.ids.includes('ztest_j3') : q.err);
    q = await query(T.B, []); ok('B whole collection with jobs leads: refused or hidden', !q.ok || !q.ids.some((x) => x.startsWith('ztest_j')), q.ok ? 'allowed, jobs rows ' + q.ids.filter((x) => x.startsWith('ztest_j')).length : q.err);
    ok('D get jobs lead refused', (await get(T.D, 'ztest_j1')) === 403);
    // trigger
    await sleep(20000);
    const t1 = (await db.doc('leads/ztest_t1').get()).data() || {}, t2 = (await db.doc('leads/ztest_t2').get()).data() || {};
    ok('onLeadCat: "דרושה חדרנית" lead got cat jobs', t1.cat === 'jobs', 'cat=' + JSON.stringify(t1.cat));
    ok('onLeadCat: event lead got cat ""', t2.cat === '', 'cat=' + JSON.stringify(t2.cat));
    // every lead has a cat (backfill)
    const all = await db.collection('leads').get(); let miss = 0, jobs = 0; all.forEach((d) => { const c = d.data().cat; if (typeof c !== 'string') miss++; if (c === 'jobs' && !d.id.startsWith('ztest')) jobs++; });
    ok('all leads have a cat field', miss === 0, `${all.size} leads, missing ${miss}, real jobs leads ${jobs}`);
  } catch (e) { fail++; console.log('ERROR ' + String(e.message || e).slice(0, 200)); }
  finally {
    for (const id of LEADS) await db.doc('leads/' + id).delete().catch(() => {});
    for (const u of Object.values(U)) { await db.doc('roles/' + u).delete().catch(() => {}); await admin.auth().deleteUser(u).catch(() => {}); }
    console.log(`::notice title=Jobs test::${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
