// Operations manager (Nov 13): admin script run by .github/workflows/ops-run.yml.
// KIND = check (config + last log lines) | morning | checkin | weekly → creates opsJobs/{id} {kind, push:false} and waits for opsJob.
// Prints ids / status / counts only (public Actions logs) — never report text, names or rooms.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'hotel-shifts' });
const db = admin.firestore();
const note = (t, m) => console.log(`::notice title=${t}::${String(m).replace(/\n/g, ' ').slice(0, 400)}`);
(async () => {
  const c = (await db.doc('agentcfg/ops').get()).data();
  note('Config', c ? `enabled=${c.enabled === true} push=${c.push === true} hkTarget=${c.hkTarget} ratios=${Object.keys(c.ratios || {}).join(',')}` : 'agentcfg/ops missing');
  const kb = (await db.doc('agentKB/ops').get()).data(); note('KB', kb ? (kb.text || '').length + ' chars' : 'missing');
  const lg = await db.collection('agentLog').where('agent', '==', 'ops').get();
  for (const d of lg.docs.map((x) => x.data()).sort((a, b) => b.at - a.at).slice(0, 10)) note('Log', `${new Date(d.at).toISOString()} ${d.kind} ${d.hotel} items=${d.items ?? '-'} stop=${d.stop || '-'} in=${(d.usage || {}).in} out=${(d.usage || {}).out} ${d.error ? 'error=' + d.error : ''}`);
  const kind = process.env.KIND; if (!['morning', 'checkin', 'weekly'].includes(kind)) return;
  const ref = await db.collection('opsJobs').add({ kind, push: false, at: Date.now(), by: 'workflow' });
  note('Job', ref.id + ' created, waiting');
  for (let i = 0; i < 70; i++) {
    await new Promise((x) => setTimeout(x, 10000));
    const j = (await ref.get()).data() || {};
    if (j.status === 'done' || j.status === 'error') {
      if (j.error) note('Job error', j.error);
      const done = Array.isArray(j.done) ? j.done : [];
      for (const d of done) note('Hotel ' + d.hotel, d.error ? 'error' : `items=${d.items ?? '-'} changes=${d.changes ?? '-'} missing=${d.missing ?? '-'}`);
      if (!done.length) note('Job', 'nothing ran (agent off?)');
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
      if (kind !== 'weekly') for (const id of done.map((d) => kind + '_' + d.hotel + '_' + today).concat(kind === 'morning' ? ['morning_chain_' + today] : [])) {
        const r = await db.doc('opsReports/' + id).get(); if (!r.exists) { note('Report ' + id, 'missing'); continue; }
        const x = r.data(); note('Report ' + id, `headline=${(x.headline || '').length}ch summary=${(x.summary || '').length}ch priorities=${(x.priorities || []).length} items=${(x.items || []).length} high=${(x.items || []).filter((i) => i.sev === 'high').length} model=${x.model || 'code'} pushed=${Object.keys(x.pushed || {}).length}`);
      }
      return;
    }
  }
  note('Job', 'still running after ~12 min');
})().catch((e) => { note('ops-run error', e.message); process.exitCode = 1; });
