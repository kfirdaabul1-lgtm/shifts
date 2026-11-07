// One-off (owner, Nov 7): historical weekly ads reports. Creates adsJobs docs (the adsJob function does the work) and waits.
// env WEEKS = comma separated Sundays (YYYY-MM-DD), SINCE = Meta insights start date ('' = skip the Meta pull).
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(ids, maxMin) {
  const t0 = Date.now();
  for (;;) {
    const s = await Promise.all(ids.map((id) => db.doc('adsJobs/' + id).get()));
    const left = s.filter((d) => !['done', 'error'].includes((d.data() || {}).status));
    if (!left.length || Date.now() - t0 > maxMin * 60e3) return s;
    await sleep(15000);
  }
}
(async () => {
  // the repo and its Actions logs are public: diag prints only ids, status and sizes, never report text or business numbers
  if (String(process.env.DIAG).startsWith('rep:')) {
    const q = await db.collection('adReports').where('week', '==', process.env.DIAG.slice(4)).get();
    q.docs.forEach((d) => { const x = d.data(); console.log('::notice title=' + d.id + '::' + JSON.stringify({ kind: x.kind, hotel: x.hotel || 'chain', backfill: !!x.backfill, chars: JSON.stringify(x).length })); });
    return;
  }
  if (String(process.env.DIAG).startsWith('chat:')) { // one test question as the owner (custom token → ID token, kept in memory only)
    const src = require('fs').readFileSync(__dirname + '/index.js', 'utf8'), key = (src.match(/WEB_KEY = '([^']+)'/) || [])[1];
    const u = await admin.auth().getUserByEmail('kfirdaabul1@gmail.com'), ct = await admin.auth().createCustomToken(u.uid);
    const t = await (await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: ct, returnSecureToken: true }) })).json();
    const [hotel, q] = process.env.DIAG.slice(5).split('|');
    const r = await fetch('https://europe-west1-hotel-shifts.cloudfunctions.net/adsAgent', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t.idToken }, body: JSON.stringify({ hotel, messages: [{ role: 'user', text: q }] }) });
    const j = await r.json().catch(() => ({}));
    console.log('::notice title=chat ' + r.status + '::' + JSON.stringify(j).slice(0, 3000));
    return;
  }
  if (process.env.DIAG === 'struct') {
    const id = 'struct_' + Date.now().toString(36); await db.doc('adsJobs/' + id).set({ kind: 'struct', at: Date.now() });
    const [d] = await waitFor([id], 9); const x = d.data() || {};
    console.log('::notice title=Structure pull::' + (x.status || '?') + ' ' + JSON.stringify(x.result || x.error || '').slice(0, 900));
    const q = await db.collection('metaStruct').get();
    q.docs.slice(0, 40).forEach((s) => { const c = s.data(); console.log('::notice title=' + String(c.name).slice(0, 60).replace(/[:,]/g, ' ') + '::' + JSON.stringify({ conn: c.metaConnName, obj: c.campaign.objective, st: c.campaign.status, sets: (c.adsets || []).length, ads: (c.ads || []).length, a0: (c.adsets || [])[0] && c.adsets[0].audience, ad0: (c.ads || [])[0], age: (c.byAgeGender || []).slice(0, 2) }).slice(0, 900)); });
    return;
  }
  if (process.env.DIAG) {
    const q = await db.collection('agentLog').orderBy('at', 'desc').limit(8).get();
    q.docs.forEach((d) => { const x = d.data(); console.log('::notice title=log::' + JSON.stringify({ agent: x.agent, at: x.at, kind: x.kind, scope: x.scope, ok: x.ok, error: x.error ? String(x.error).slice(0, 200) : undefined })); });
    return;
  }
  const stamp = Date.now().toString(36), since = process.env.SINCE || '';
  if (since) {
    const id = 'meta_' + stamp; await db.doc('adsJobs/' + id).set({ kind: 'meta', since, at: Date.now() });
    const [d] = await waitFor([id], 9); const x = d.data() || {};
    console.log('::notice title=Meta pull::' + (x.status || '?') + ' ' + JSON.stringify(x.error || (x.result ? 'done' : '')).slice(0, 300));
  }
  const weeks = String(process.env.WEEKS || '').split(',').map((w) => w.trim()).filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w));
  const ids = [];
  for (const w of weeks) { const id = 'week_' + w + '_' + stamp; ids.push(id); await db.doc('adsJobs/' + id).set({ kind: 'week', week: w, at: Date.now() }); await sleep(3000); }
  const done = await waitFor(ids, 25);
  for (const d of done) {
    const x = d.data() || {}, r = Array.isArray(x.result) ? x.result : [];
    console.log('::notice title=Week ' + x.week + '::' + (x.status || 'pending') + ' · ' + r.map((y) => y.scope + ':' + (y.report ? 'ok' : (y.skipped || y.error || '?'))).join(' | ').slice(0, 900));
  }
})().catch((e) => { console.log('::error title=ads backfill::' + String(e.message || e).slice(0, 300)); process.exit(1); });
