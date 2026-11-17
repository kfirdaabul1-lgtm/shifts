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
  { // Arsona guest requests + the nag state (counts only)
    const now = Date.now(), all = (await db.collection('guestReqs').get()).docs.map((d) => d.data() || {});
    const b = { open: 0, taken: 0, done: 0, other: 0 }, age = { u10: 0, m10_4h: 0, o4h: 0 }; let noHotel = 0;
    for (const r of all) { b[r.status in b ? r.status : 'other']++; if (r.status === 'open') { const m = (now - (+r.at || now)) / 60e3; if (m < 10) age.u10++; else if (m < 240) age.m10_4h++; else age.o4h++; if (!r.hotel) noHotel++; } }
    note('GuestReqs', `total=${all.length} ${JSON.stringify(b)} openAge=${JSON.stringify(age)} openNoHotel=${noHotel}`);
    const g = (await db.doc('opsWatch/greqNag').get()).data() || {}; note('Nag state', `at=${g.at ? new Date(g.at).toISOString() : '-'} tracked=${Object.keys(g.sent || {}).length} steps=${JSON.stringify(Object.values(g.sent || {}))}`);
    const wl = (await db.collection('agentLog').where('agent', '==', 'ops').get()).docs.map((d) => d.data()).filter((d) => d.kind === 'greq-wa' && d.at > now - 2 * 864e5);
    note('Nag WhatsApp 48h', `sent=${wl.length} ok=${wl.filter((d) => !d.error).length} errors=${[...new Set(wl.map((d) => d.error).filter(Boolean))].slice(0, 3).join(' | ')}`);
  }
  const kind = process.env.KIND;
  if (kind === 'hkplan') { // Aliana's housekeeping plan for tomorrow (counts only)
    const ref = await db.collection('opsJobs').add({ kind, push: false, at: Date.now(), by: 'workflow' }); note('Job', ref.id + ' created');
    for (let i = 0; i < 40; i++) { await new Promise((x) => setTimeout(x, 6000)); const j = (await ref.get()).data() || {};
      if (j.status) { if (j.error) note('Job error', j.error); for (const d of j.done || []) note('Hotel ' + d.hotel, d.error ? 'error' : `rooms=${d.rooms} crew=${d.crew} pri=${d.pri} shortage=${d.shortage} noRoom=${d.noRoom}`); note('Day', j.day || '-'); return; } }
    note('Job', 'still running'); return;
  }
  if (!['morning', 'checkin', 'weekly'].includes(kind)) return;
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
