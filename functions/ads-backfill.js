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
