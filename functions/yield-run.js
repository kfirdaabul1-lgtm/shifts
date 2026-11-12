// Yield agent "Guy" (Nov 12): admin script run by .github/workflows/yield-run.yml.
// 1) creates the yieldReports composite indexes (hotel+at, hotel+kind+at) when missing, 2) when KIND is set, creates yieldJobs/{id} {kind}
// and waits for the yieldJob function. Prints ids / status / sizes only (public Actions logs) — never report text.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore(), P = 'hotel-shifts';
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 400)}`);
(async () => {
  const { access_token: t } = await admin.credential.applicationDefault().getAccessToken(), H = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  const base = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/collectionGroups/yieldReports/indexes`;
  const have = await (await fetch(base, { headers: H })).json();
  const sig = (f) => f.filter((x) => x.fieldPath !== '__name__').map((x) => x.fieldPath + ':' + (x.order || x.arrayConfig)).join(',');
  const existing = new Set((have.indexes || []).map((i) => sig(i.fields || [])));
  for (const fields of [[['hotel', 'ASCENDING'], ['at', 'DESCENDING']], [['hotel', 'ASCENDING'], ['kind', 'ASCENDING'], ['at', 'DESCENDING']]]) {
    const f = fields.map(([fieldPath, order]) => ({ fieldPath, order })), s = sig(f);
    if (existing.has(s)) { note('Index', s + ' exists'); continue; }
    const r = await (await fetch(base, { method: 'POST', headers: H, body: JSON.stringify({ queryScope: 'COLLECTION', fields: f }) })).json();
    note('Index', s + ': ' + (r.error ? 'error ' + r.error.message : 'creating'));
  }
  const c = (await db.doc('agentcfg/yield').get()).data();
  note('Config', c ? 'agentcfg/yield enabled=' + (c.enabled === true) : 'agentcfg/yield missing');
  const kind = process.env.KIND; if (!kind) return;
  const ref = await db.collection('yieldJobs').add({ kind: kind === 'weekly' ? 'weekly' : 'daily', at: Date.now(), by: 'workflow' });
  note('Job', ref.id + ' created, waiting');
  for (let i = 0; i < 70; i++) {
    await new Promise((x) => setTimeout(x, 10000));
    const j = (await ref.get()).data() || {};
    if (j.status === 'done' || j.status === 'error') {
      if (j.error) note('Job error', j.error);
      for (const d of j.done || []) note('Scope ' + d.scope, d.report ? 'report ' + d.report : d.skipped ? 'skipped: ' + d.skipped : 'error: ' + d.error);
      if (!(j.done || []).length && j.status === 'done') note('Job', 'nothing ran (agent off?)');
      const reps = await Promise.all((j.done || []).filter((d) => d.report).map((d) => db.doc('yieldReports/' + d.report).get()));
      for (const r of reps) if (r.exists) { const x = r.data(); note('Report ' + r.id, `page=${x.pageStatus} findings=${(x.findings || []).length} recs=${(x.recommendations || []).length} questions=${(x.questionsForRm || []).length} model=${x.model}`); }
      return;
    }
  }
  note('Job', 'still running after ~12 min');
})().catch((e) => { note('yield-run error', e.message); process.exitCode = 1; });
